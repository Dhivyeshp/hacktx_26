import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import type { DB } from "./db";
import { getSession, save } from "./db";
import { tokenHash } from "./security";
import { appendTranscript, ensureConversation } from "./conversation";

export function deepgramSegments(
  message: unknown,
  streamId: string,
  startedAt: number,
) {
  const m = message as any;
  if (m?.type !== "Results" || m.is_final !== true) return [];
  const a = m.channel?.alternatives?.[0];
  if (
    !a ||
    typeof a.transcript !== "string" ||
    (typeof a.confidence === "number" && a.confidence < 0.5)
  )
    return [];
  const groups: { speaker?: number; text: string[] }[] = [];
  if (Array.isArray(a.words) && a.words.length) {
    for (const word of a.words.slice(0, 500)) {
      const text = word.punctuated_word || word.word;
      if (typeof text !== "string") continue;
      const speaker =
        Number.isSafeInteger(word.speaker) && word.speaker >= 0
          ? word.speaker
          : undefined;
      if (!groups.length || groups.at(-1)!.speaker !== speaker)
        groups.push({ speaker, text: [] });
      groups.at(-1)!.text.push(text);
    }
  } else groups.push({ text: [a.transcript] });
  const start = Number.isFinite(m.start) ? Math.max(0, m.start) : 0;
  return groups
    .slice(0, 50)
    .map((group, index) => ({
      id: `${streamId}:${start}:${index}`,
      text: group.text.join(" ").trim().slice(0, 1600),
      speakerLabel:
        group.speaker === undefined
          ? undefined
          : `${streamId.slice(0, 8)}-speaker-${group.speaker + 1}`,
      at: startedAt + start * 1000,
    }))
    .filter((segment) => segment.text);
}
export function createAudioBridge(
  db: DB,
  connect: (url: URL, options: import("ws").ClientOptions) => WebSocket = (
    url,
    options,
  ) => new WebSocket(url, options),
) {
  const streams = new Map<string, () => void>();
  const ticket = async (
    sessionId: string,
    format: "container" | "linear16",
  ) => {
    const token = randomBytes(32).toString("hex"),
      expiresAt = Date.now() + 60000;
    await db
      .prepare("DELETE FROM audio_tickets WHERE expires_at<?")
      .run(Date.now());
    await db
      .prepare("INSERT INTO audio_tickets VALUES(?,?,?,?)")
      .run(tokenHash(token), sessionId, expiresAt, format);
    return { token, expiresAt, path: "/api/audio" };
  };
  const stop = (sessionId: string) => streams.get(sessionId)?.();
  function attach(server: Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    const upgrade = (req: any, socket: any, head: Buffer) => {
      if (new URL(req.url, "http://localhost").pathname !== "/api/audio")
        return;
      const origin = req.headers.origin;
      const valid = [
        process.env.PUBLIC_URL,
        `http://${req.headers.host}`,
        `https://${req.headers.host}`,
      ];
      if (origin && !valid.includes(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
    };
    server.on("upgrade", upgrade);
    wss.on("connection", (client) => {
      let provider: WebSocket | undefined,
        roomId = "",
        ready = false,
        closed = false;
      let keep: ReturnType<typeof setInterval> | undefined,
        minutes: ReturnType<typeof setInterval> | undefined,
        idle: ReturnType<typeof setTimeout> | undefined;
      const authTimeout = setTimeout(
        () => client.close(1008, "Authenticate first"),
        5000,
      );
      /**
       * Every socket event that reads and rewrites the session runs through one
       * queue. TigerDB is a network hop away, so two overlapping handlers would
       * otherwise read the same session body and one would lose its segments.
       */
      let queue: Promise<unknown> = Promise.resolve();
      const serial = <T>(work: () => Promise<T>) =>
        (queue = queue.then(work, work));
      /** Closes synchronously; the paused notice is written behind the queue. */
      function cleanup(reason = "Listening paused.") {
        if (closed) return;
        closed = true;
        clearTimeout(authTimeout);
        clearInterval(keep);
        clearInterval(minutes);
        clearTimeout(idle);
        provider?.terminate();
        client.close(1000, "Stopped");
        if (!roomId) return;
        const id = roomId;
        streams.delete(id);
        void serial(async () => {
          const s = await getSession(db, id);
          if (s && s.status !== "finished") {
            const c = ensureConversation(s);
            c.status = "paused";
            c.notice = reason;
            s.version++;
            await save(db, s);
          }
        });
      }
      async function reserveMinute() {
        const limit = Number(process.env.DEEPGRAM_MAX_MINUTES || 30);
        if (!Number.isSafeInteger(limit) || limit < 1)
          throw new Error("Recording allowance exhausted.");
        await db.transaction(async (tx) => {
          const row = (await tx
            .prepare(
              "SELECT count(*)::int AS n FROM audio_minutes WHERE session_id=?",
            )
            .get<{ n: number }>(roomId))!;
          if (row.n >= limit) throw new Error("Recording allowance exhausted.");
          await tx
            .prepare("INSERT INTO audio_minutes VALUES(?,?,?)")
            .run(randomUUID(), roomId, Date.now());
        });
      }
      async function onMessage(data: WebSocket.RawData, binary: boolean) {
        if (closed) return;
        if (!roomId) {
          try {
            const message = JSON.parse(data.toString());
            if (
              binary ||
              message.type !== "auth" ||
              typeof message.token !== "string"
            )
              throw new Error();
            const grant = await db
              .prepare(
                "DELETE FROM audio_tickets WHERE token=? AND expires_at>? RETURNING session_id,format",
              )
              .get<{ session_id: string; format: string }>(
                tokenHash(message.token),
                Date.now(),
              );
            const s = grant && (await getSession(db, grant.session_id));
            if (
              !grant ||
              !s ||
              s.status === "finished" ||
              streams.has(s.id) ||
              !process.env.DEEPGRAM_API_KEY
            )
              throw new Error();
            roomId = s.id;
            await reserveMinute();
            clearTimeout(authTimeout);
            streams.set(roomId, () => cleanup());
            const streamId = randomUUID(),
              startedAt = Date.now();
            const url = new URL("wss://api.deepgram.com/v1/listen");
            url.search = new URLSearchParams({
              model: process.env.DEEPGRAM_MODEL || "nova-3",
              language: "en",
              smart_format: "true",
              interim_results: "false",
              diarize_model: "v1",
              endpointing: "500",
              ...(grant.format === "linear16"
                ? { encoding: "linear16", sample_rate: "16000", channels: "1" }
                : {}),
            }).toString();
            provider = connect(url, {
              headers: {
                Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
              },
              handshakeTimeout: 10000,
              maxPayload: 1024 * 1024,
            });
            provider.on("open", () => {
              if (closed) return;
              ready = true;
              void serial(async () => {
                if (closed) return;
                const latest = (await getSession(db, roomId))!;
                const c = ensureConversation(latest);
                c.status = "live";
                c.notice = undefined;
                latest.version++;
                await save(db, latest);
                client.send(JSON.stringify({ type: "ready" }));
              });
              keep = setInterval(() => {
                if (provider?.readyState === WebSocket.OPEN)
                  provider.send(JSON.stringify({ type: "KeepAlive" }));
              }, 4000);
              minutes = setInterval(() => {
                void serial(async () => {
                  try {
                    await reserveMinute();
                  } catch {
                    cleanup(
                      "Recording allowance reached. Transcript testing is still available.",
                    );
                  }
                });
              }, 60000);
              idle = setTimeout(
                () =>
                  cleanup(
                    "No audio arrived. Start listening again when ready.",
                  ),
                20000,
              );
            });
            // Queued: each result reads the session, appends to it and writes
            // it back, so two results must never be in flight together.
            provider.on("message", (raw) => {
              if (closed) return;
              void serial(async () => {
                if (closed) return;
                try {
                  const message = JSON.parse(raw.toString());
                  if (message.type === "Error") {
                    cleanup(
                      "Transcription failed. Check the service key and try again.",
                    );
                    return;
                  }
                  const latest = await getSession(db, roomId);
                  if (!latest || latest.status === "finished") return cleanup();
                  let changed = false;
                  for (const segment of deepgramSegments(
                    message,
                    streamId,
                    startedAt,
                  ))
                    changed =
                      appendTranscript(
                        latest,
                        segment,
                        "microphone",
                        segment.at,
                      ) || changed;
                  if (changed) {
                    latest.version++;
                    await save(db, latest);
                    client.send(JSON.stringify({ type: "transcript.updated" }));
                  }
                } catch {
                  cleanup("Transcription returned an unreadable response.");
                }
              });
            });
            provider.on("error", () =>
              cleanup(
                "Couldn’t connect to transcription. Check DEEPGRAM_API_KEY and your connection.",
              ),
            );
            provider.on("close", () =>
              cleanup("Transcription disconnected. Start again when ready."),
            );
          } catch {
            client.send(
              JSON.stringify({
                type: "error",
                message:
                  "The audio ticket is invalid, busy, expired or the recording allowance was reached.",
              }),
            );
            cleanup();
          }
          return;
        }
        if (!binary) {
          try {
            if (JSON.parse(data.toString()).type === "stop") cleanup();
          } catch {}
          return;
        }
        if (!ready || provider?.readyState !== WebSocket.OPEN) return;
        if (provider.bufferedAmount > 512 * 1024)
          return cleanup(
            "Audio connection is too slow. Start again when ready.",
          );
        clearTimeout(idle);
        idle = setTimeout(
          () => cleanup("No audio arrived. Start listening again when ready."),
          20000,
        );
        provider.send(data, { binary: true });
      }
      /**
       * Audio frames are forwarded straight through: they touch no database, so
       * a queued write must never hold up the stream. Everything else, the
       * handshake included, is serialised.
       */
      client.on("message", (data, binary) => {
        if (closed) return;
        if (roomId && binary) void onMessage(data, binary);
        else void serial(() => onMessage(data, binary));
      });
      client.on("close", () => cleanup());
      client.on("error", () => cleanup());
    });
    return () => {
      server.off("upgrade", upgrade);
      for (const close of streams.values()) close();
      for (const client of wss.clients) client.terminate();
      wss.close();
    };
  }
  return { ticket, stop, attach };
}
