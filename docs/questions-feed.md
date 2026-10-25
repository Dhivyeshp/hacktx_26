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

## Browser control and conversation

CLI grants default to read-only. `questions:link -- ROOM --control` creates an
explicit control grant; existing cookies keep their original permission.
`POST /api/questions/login` with the GM key grants control. Control cookies
remain room-scoped and cannot authenticate bearer control endpoints.

Authenticated browser controls post to `/api/questions/recommendations`, `/assign`,
`/clear`, `/conversation`, `/transcript`, `/speaker` and `/audio-ticket`. The
existing `/api/control/rooms/:code/*` bearer routes use the same handlers.
`canControl` determines the displayed controls. Writes enforce permission on the server.

Conversation snapshots include private final transcript segments, confirmed
speaker mappings, tentative solo-prompt speaker hints, summary and request usage.
Test text is labeled as such. No transcript or secret queue is in player snapshots.
The authenticated `/api/audio` WebSocket accepts a one-use ticket in its first
frame, then binary audio. Deepgram credentials remain on the server.

Pages fetch authoritative HTTP state every four seconds while visible and on
visibility/pageshow. Polling and transcript events never call Muse. Optional
between-turn generation occurs only when a turn is cleared and enough new text
exists. The later Vision Pro relay adapter is still separate work.
See [live conversation](live-conversation.md) for operation and limits.
