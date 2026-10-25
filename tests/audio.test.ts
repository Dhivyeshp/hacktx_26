import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { openDb, getSession } from "../server/db";
import { createRoom } from "../server/rooms";
import { createAudioBridge, deepgramSegments } from "../server/audio";
import { resetLiveRecordings } from "../server/conversation";

const result = {
  type: "Results",
  is_final: true,
  start: 0,
  channel: {
    alternatives: [
      {
        transcript: "Hello there.",
        confidence: 0.99,
        words: [
          { word: "Hello", speaker: 0 },
          { punctuated_word: "there.", speaker: 0 },
        ],
      },
    ],
  },
};
test("only final confident transcripts are split into anonymous speaker segments", () => {
  assert.deepEqual(
    deepgramSegments({ ...result, is_final: false }, "stream", 0),
    [],
  );
  const segments = deepgramSegments(result, "stream-123456789", 0);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "Hello there.");
  assert.equal(segments[0].speakerLabel, "stream-1-speaker-1");
  assert.deepEqual(
    deepgramSegments(
      {
        type: "Results",
        is_final: true,
        channel: { alternatives: [{ transcript: "Noise", confidence: 0.1 }] },
      },
      "stream",
      0,
    ),
    [],
  );
});
test("audio bridge requires a one-use ticket, proxies audio without exposing keys, and stops cleanly", async () => {
  const db = openDb(":memory:");
  const room = createRoom(db, "Audio test");
  const fakeServer = createServer();
  const providerServer = new WebSocketServer({ server: fakeServer });
  fakeServer.listen(0, "127.0.0.1");
  await once(fakeServer, "listening");
  const fakeUrl = `ws://127.0.0.1:${(fakeServer.address() as any).port}`;
  let providerConnection: WebSocket | undefined;
  let connections = 0;
  providerServer.on("connection", (socket) => {
    providerConnection = socket;
    connections++;
  });
  process.env.DEEPGRAM_API_KEY = "fake-deepgram-test-key";
  const bridge = createAudioBridge(db, (url, options) => {
    assert.equal(url.hostname, "api.deepgram.com");
    assert.equal(url.searchParams.get("encoding"), "linear16");
    assert.equal(
      (options.headers as any).Authorization,
      "Token fake-deepgram-test-key",
    );
    assert.ok(!url.toString().includes("fake-deepgram"));
    return new WebSocket(fakeUrl);
  });
  const server = createServer();
  const detach = bridge.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `ws://127.0.0.1:${(server.address() as any).port}/api/audio`;
  const clients: WebSocket[] = [];
  try {
    const invalid = new WebSocket(endpoint);
    clients.push(invalid);
    await once(invalid, "open");
    const rejected = once(invalid, "message");
    invalid.send(JSON.stringify({ type: "auth", token: "bad" }));
    assert.equal(JSON.parse(String((await rejected)[0])).type, "error");
    assert.equal(connections, 0);
    const ticket = bridge.ticket(room.id, "linear16");
    const client = new WebSocket(endpoint);
    clients.push(client);
    await once(client, "open");
    const ready = once(client, "message");
    client.send(JSON.stringify({ type: "auth", token: ticket.token }));
    assert.equal(JSON.parse(String((await ready)[0])).type, "ready");
    assert.equal(connections, 1);
    const media = once(providerConnection!, "message");
    client.send(Buffer.from([0, 0, 1, 0]));
    assert.deepEqual(
      Buffer.from((await media)[0] as Buffer),
      Buffer.from([0, 0, 1, 0]),
    );
    const transcript = once(client, "message");
    providerConnection!.send(JSON.stringify(result));
    await transcript;
    assert.equal(
      getSession(db, room.id)!.conversation!.segments[0].origin,
      "microphone",
    );
    const reuse = new WebSocket(endpoint);
    clients.push(reuse);
    await once(reuse, "open");
    const denied = once(reuse, "message");
    reuse.send(JSON.stringify({ type: "auth", token: ticket.token }));
    assert.equal(JSON.parse(String((await denied)[0])).type, "error");
    assert.equal(connections, 1);
    bridge.stop(room.id);
    assert.equal(getSession(db, room.id)!.conversation!.status, "paused");
    const s = getSession(db, room.id)!;
    s.conversation!.status = "live";
    db.prepare("UPDATE sessions SET body=? WHERE id=?").run(
      JSON.stringify(s),
      s.id,
    );
    resetLiveRecordings(db);
    assert.equal(getSession(db, s.id)!.conversation!.status, "paused");
  } finally {
    clients.forEach((client) => client.terminate());
    detach();
    providerServer.clients.forEach((client) => client.terminate());
    providerServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
    db.close();
    delete process.env.DEEPGRAM_API_KEY;
  }
});
