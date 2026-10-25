# TigerDB transcript store

Destina keeps its game state in SQLite. TigerDB holds a parallel, time-series
copy of the transcript so it can be queried by time and speaker, and so a
polling client can ask only for what is new. The Vision Pro Game Master reads
the transcript this way.

TigerDB is optional. With `TIGER_DATABASE_URL` unset the server behaves exactly
as it did before: transcripts are stored in the session JSON in SQLite and the
read endpoint serves them from there. Nothing in the game depends on TigerDB
being reachable.

## What is stored

One row per final transcript segment: the timestamp, room, segment id,
sequence, round id, speaker label, origin (`microphone` or `test`), word count
and text. The same boundary as the rest of the system applies, as described in
[live conversation](live-conversation.md): final transcript text is stored,
raw audio never is. Speaker labels are Deepgram's diarization labels, not
names. Confirmed name mappings stay in SQLite, because they are game state a
Game Master edits, not time-series data.

Player profiles, Instagram text, interests, prompts, rewards and credentials
are not written to TigerDB.

## Setting it up

1. Create a TigerData service and copy its connection string.
2. Put it in `.env`:

```sh
TIGER_DATABASE_URL=postgres://user:password@host:port/dbname
TIGER_SSL_MODE=require
```

   Use `TIGER_SSL_MODE=disable` only for a local Postgres without TLS.

3. Create the schema. The migration is idempotent and safe to re-run:

```sh
npm run tigerdb:migrate
```

4. Restart the server.

The migration creates a `transcript_segments` hypertable partitioned on `at`,
an index on `(room_id, at DESC)`, and a `speaker_activity_minute` continuous
aggregate that buckets segment and word counts per minute per speaker. The
refresh policy needs a plan that allows background jobs. If it is skipped, the
view still works after a manual refresh:

```sql
CALL refresh_continuous_aggregate('speaker_activity_minute', NULL, NULL);
```

## Checking it

```sh
npm run tigerdb:check
```

This prints the chunk count and, per room, the number of segments and words
with the first and last timestamp. An empty result means no transcript has been
recorded yet, not that the connection failed; a connection problem exits with
an error instead.

To produce rows without a microphone, open `/gm` with control access and use
"Test with pasted conversation". Those rows are recorded with `origin = 'test'`,
the same label the interface shows.

## Reading it

```
GET /api/control/rooms/:code/transcript?since=<ms>&limit=<n>
Authorization: Bearer $GM_API_KEY
```

Returns `{ source, segments, speakers }`. `source` is `"tigerdb"` when the
store answered and `"session"` when it fell back, so a client can tell which
path it is on. `segments` is newest-last so a caller can append it to what it
already shows; pass the last `at` it received back as `since` to page forward.
`limit` defaults to 100 and is capped at 400, matching the in-session retention
bound. `speakers` carries the per-speaker activity from the continuous
aggregate, and is empty on the fallback path.

The same route is mounted at `GET /api/questions/transcript` for a browser Game
Master with control access.

## Failure behaviour

Writes are fire and forget. A TigerDB outage cannot fail or delay a transcript
write, an HTTP request or a recording session. Reads fall back to the session
copy. Failures log a single namespaced line, `[tigerdb] write failed`, and never
include the connection string, the host or a driver error.

Because writes are not awaited, a row that fails to insert is not retried. The
session copy in SQLite remains complete for the most recent 400 segments, so
TigerDB should be treated as a queryable history rather than the authoritative
record.
