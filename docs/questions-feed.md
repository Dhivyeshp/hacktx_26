# Private question feed

The player NFC route is `/prompt`. Legacy `/relic` and `/c` links redirect there while preserving query parameters. `/api/relic` and `/api/capsule` remain compatible. GET `/api/prompt` uses the existing player cookie and returns a
`CapsuleSnapshot`. An unauthenticated phone must join a room first. Public prompt
text is shared; private mission text is filtered on the server by player ID.

The private GM route is `/questions`. Its `QuestionsSnapshot` includes named
players, chronological suggestion batches, current selection and round history.
Player rows include names, saved-interest readiness and recorded turn counts. It excludes raw profile excerpts, Instagram tokens and player credentials.
Batches are persisted in the session JSON in SQLite when generation succeeds.
The original candidate stays in its batch; an edited selection is represented by
the round’s recommendation. Sessions from before this feature show any remaining
queue and known round history; previously discarded candidates cannot be recovered.

## Read access

An authenticated control adapter posts to
`/api/control/rooms/:code/questions-access` with its existing bearer credential.
The response contains `url`, `path` and `expiresAt`. The URL’s fragment carries a
random single-use token valid for ten minutes. Only its hash is stored. The page
removes the fragment and exchanges the token through POST `/api/questions/access`.
The response sets an HttpOnly, SameSite=Strict cookie scoped to `/api/questions`
for twelve hours. It is Secure when PUBLIC_URL uses HTTPS. The local
`questions:link` CLI creates the same grants without exposing the global GM key.
Do not log or share these private links publicly.

POST `/api/questions/login` accepts `{code, key}` as an alternative. GET
`/api/questions/session?room=CODE` returns the room-scoped feed. DELETE at the same
path revokes the read cookie. A player cookie or read cookie never grants control
API access. All API responses use `Cache-Control: no-store`; cross-origin writes
are rejected by the shared middleware.

## Conversation and later transport

The feed has schemaVersion 1 and an explicit
`conversation: {status: "not_connected", segments: []}` today. No transcript is
invented or recorded. A later authorized ingestion path can persist transcript
segments and batches with `origin: "conversation"`. It must define recording
consent, retention and GM access before accepting real conversation content.

For now, both pages fetch authoritative HTTP state every four seconds while
visible and on visibility/pageshow. They never generate questions implicitly.
The later WebSocket adapter can send room-version invalidations that trigger
these same authorized fetches. Do not broadcast this private feed on public
player channels. Selection still uses the existing bearer-protected control API.
