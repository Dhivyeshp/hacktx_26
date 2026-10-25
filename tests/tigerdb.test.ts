import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { openDb } from "../server/db";
import { createRoom } from "../server/rooms";
import { createApp } from "../server/app";
import { appendTranscript } from "../server/conversation";
import { tigerEnabled, readSegments, speakerActivity } from "../server/tigerdb";

// These tests cover the disabled path, which is the one that must never break:
// a server with no TIGER_DATABASE_URL has to behave exactly as it did before.
// Hypertable behaviour needs a real TimescaleDB and is covered by
// `npm run tigerdb:check` in docs/tigerdb.md.
delete process.env.TIGER_DATABASE_URL;
process.env.GM_API_KEY = "test-control-credential";
const dir = mkdtempSync(join(tmpdir(), "centerpiece-tiger-"));
process.env.MODEL_USAGE_PATH = join(dir, "model-usage.db");
const db = openDb(join(dir, "tiger.db"));
const { app } = createApp(db);
const server = createServer(app);
await once(server.listen(0), "listening");
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const control = { authorization: "Bearer test-control-credential" };

test("the transcript store is inert without a connection string", async () => {
  assert.equal(tigerEnabled(), false);
  assert.equal(await readSegments("ROOM"), undefined);
  assert.deepEqual(await speakerActivity("ROOM"), []);
});

test("appending a transcript still works and still dedupes", () => {
  const s = createRoom(db, "Tiger table");
  assert.equal(
    appendTranscript(s, { id: "a", text: "hello there" }, "test"),
    true,
  );
  assert.equal(
    appendTranscript(s, { id: "a", text: "hello there" }, "test"),
    false,
  );
  assert.equal(s.conversation?.segments.length, 1);
});

test("the transcript read endpoint falls back to the session copy", async () => {
  const s = createRoom(db, "Tiger read");
  appendTranscript(s, { id: "one", text: "first line" }, "test", 1000);
  appendTranscript(s, { id: "two", text: "second line" }, "test", 2000);
  const { save } = await import("../server/db");
  save(db, s);

  const response = await fetch(
    `${base}/api/control/rooms/${s.code}/transcript`,
    { headers: control },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, "session");
  assert.deepEqual(
    body.segments.map((segment: { id: string }) => segment.id),
    ["one", "two"],
  );
  assert.deepEqual(body.speakers, []);

  const since = await fetch(
    `${base}/api/control/rooms/${s.code}/transcript?since=1000`,
    { headers: control },
  );
  const page = await since.json();
  assert.deepEqual(
    page.segments.map((segment: { id: string }) => segment.id),
    ["two"],
  );
});

test("the bearer feed returns the full Game Master snapshot", async () => {
  const s = createRoom(db, "Tiger feed");
  const response = await fetch(
    `${base}/api/control/rooms/${s.code}/questions`,
    {
      headers: control,
    },
  );
  assert.equal(response.status, 200);
  const feed = await response.json();
  assert.equal(feed.schemaVersion, 1);
  assert.equal(feed.canControl, true);
  assert.equal(feed.room.code, s.code);
  // The thin controlSnapshot has none of these; the headset needs all of them.
  for (const key of ["batches", "history", "conversation", "availableIds"])
    assert.ok(key in feed, `missing ${key}`);
});

test("the bearer feed rejects a missing credential", async () => {
  const s = createRoom(db, "Tiger auth");
  const response = await fetch(`${base}/api/control/rooms/${s.code}/questions`);
  assert.equal(response.status, 403);
});

test.after(() => server.close());
