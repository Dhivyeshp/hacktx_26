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
  db.exec(
    "CREATE TABLE IF NOT EXISTS audio_minutes(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,at INTEGER NOT NULL)",
  );
  const streams = new Map<string, () => void>();
  const ticket = (sessionId: string, format: "container" | "linear16") => {
    const token = randomBytes(32).toString("hex"),
      expiresAt = Date.now() + 60000;
    db.prepare("DELETE FROM audio_tickets WHERE expires_at<?").run(Date.now());
    db.prepare("INSERT INTO audio_tickets VALUES(?,?,?,?)").run(
      tokenHash(token),
      sessionId,
      expiresAt,
      format,
    );
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
      function cleanup(reason = "Listening paused.") {
        if (closed) return;
        closed = true;
        clearTimeout(authTimeout);
        clearInterval(keep);
        clearInterval(minutes);
        clearTimeout(idle);
        provider?.terminate();
        client.close(1000, "Stopped");
        if (roomId) {
          streams.delete(roomId);
          const s = getSession(db, roomId);
          if (s && s.status !== "finished") {
            const c = ensureConversation(s);
            c.status = "paused";
            c.notice = reason;
            s.version++;
            save(db, s);
          }
        }
      }
      function reserveMinute() {
        const limit = Number(process.env.DEEPGRAM_MAX_MINUTES || 30);
        if (!Number.isSafeInteger(limit) || limit < 1)
          throw new Error("Recording allowance exhausted.");
        db.transaction(() => {
          const row = db
            .prepare("SELECT count(*) n FROM audio_minutes WHERE session_id=?")
            .get(roomId) as { n: number };
          if (row.n >= limit) throw new Error("Recording allowance exhausted.");
          db.prepare("INSERT INTO audio_minutes VALUES(?,?,?)").run(
            randomUUID(),
            roomId,
            Date.now(),
          );
        }).immediate();
      }
      client.on("message", (data, binary) => {
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
            const grant = db
              .prepare(
                "DELETE FROM audio_tickets WHERE token=? AND expires_at>? RETURNING session_id,format",
              )
              .get(tokenHash(message.token), Date.now()) as
              { session_id: string; format: string } | undefined;
            const s = grant && getSession(db, grant.session_id);
            if (
              !grant ||
              !s ||
              s.status === "finished" ||
              streams.has(s.id) ||
              !process.env.DEEPGRAM_API_KEY
            )
              throw new Error();
            roomId = s.id;
            reserveMinute();
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
              const latest = getSession(db, roomId)!;
              const c = ensureConversation(latest);
              c.status = "live";
              c.notice = undefined;
              latest.version++;
              save(db, latest);
              client.send(JSON.stringify({ type: "ready" }));
              keep = setInterval(() => {
                if (provider?.readyState === WebSocket.OPEN)
                  provider.send(JSON.stringify({ type: "KeepAlive" }));
              }, 4000);
              minutes = setInterval(() => {
                try {
                  reserveMinute();
                } catch {
                  cleanup(
                    "Recording allowance reached. Transcript testing is still available.",
                  );
                }
              }, 60000);
              idle = setTimeout(
                () =>
                  cleanup(
                    "No audio arrived. Start listening again when ready.",
                  ),
                20000,
              );
            });
            provider.on("message", (raw) => {
              if (closed) return;
              try {
                const message = JSON.parse(raw.toString());
                if (message.type === "Error") {
                  cleanup(
                    "Transcription failed. Check the service key and try again.",
                  );
                  return;
                }
                const latest = getSession(db, roomId);
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
                  save(db, latest);
                  client.send(JSON.stringify({ type: "transcript.updated" }));
                }
              } catch {
                cleanup("Transcription returned an unreadable response.");
              }
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
