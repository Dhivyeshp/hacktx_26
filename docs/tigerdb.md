# TigerDB store

TigerDB holds everything Destina persists. There is no local database file and
no SQLite any more: game state, player credentials, Game Master access grants,
reward reviews and settlement jobs, and the transcript all live in one TigerDB
service. `TIGER_DATABASE_URL` is required, and the server will not start
without it.

The transcript keeps its own time-series shape on top of that. It is a
hypertable queried by time and speaker, so a polling client can ask only for
what is new. The Vision Pro Game Master reads the transcript this way.

## What is stored

**Game state.** One `sessions` row per room, holding the room's JSON body:
players, approved interests, prompts, rounds, notices and the recent transcript
the Game Master sees. `events` is the append-only room event log. `credentials`,
`connections`, `oauth`, `questions_invites`, `questions_access` and
`audio_tickets` hold hashed tokens and their expiry; `audio_minutes`,
`game_model_attempts` and `model_usage` are the recording and Muse request
ledgers. `reward_settings`, `reward_reviews`, `reward_wallets`, `reward_jobs`
and `reward_audit` carry the Tina Token review and settlement records.

Tokens are stored as SHA-256 hashes, and Instagram access tokens and wallet
secrets are encrypted with `TOKEN_ENCRYPTION_KEY` before they are written.
Those boundaries are unchanged by the move; only the destination changed.

**Transcript.** One `transcript_segments` row per final segment: the timestamp,
room, segment id, sequence, round id, speaker label, origin (`microphone` or
`test`), word count and text. The same boundary as the rest of the system
applies, as described in [live conversation](live-conversation.md): final
transcript text is stored, raw audio never is. Speaker labels are Deepgram's
diarization labels, not names. Confirmed name mappings stay in the session body,
because they are game state a Game Master edits, not time-series data.

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

The migration creates every game table, and then a `transcript_segments`
hypertable partitioned on `at`,
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

This prints the chunk count, the game-state row counts, and, per room, the
number of segments and words with the first and last timestamp. An empty result means no transcript has been
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

TigerDB is now on the critical path for game state: a request that cannot reach
it fails with the generic server error, the same as any other backend failure.
Failures log a single namespaced line, such as `[tigerdb] write failed`, and
never include the connection string, the host or a driver error.

The transcript hypertable is the one exception and still degrades rather than
fails. Segment writes are fire and forget, so a slow insert cannot delay the
transcript the players depend on, and the read endpoint falls back to the copy
in the session body when the hypertable does not answer. Because those writes
are not awaited, a row that fails to insert is not retried; the session body
stays complete for the most recent 400 segments, so the hypertable is best
treated as queryable history rather than the authoritative record.

## Concurrency

Every session write is a read-modify-write of one JSON body, and TigerDB is a
network hop away rather than an in-process file. Two paths needed explicit
ordering because of that:

- The audio bridge serialises everything on a socket that reads and rewrites a
  session through a single per-connection queue, so two Deepgram results can
  never both read the same body and one lose its segments. Audio frames bypass
  the queue, since forwarding them touches no database.
- Request handlers that span an await, such as preparing prompts, re-read the
  session afterwards and compare it against the baseline they captured, which
  is the check that was already there for concurrent Game Master edits.
