# Voice introductions

Players can open “In your own words,” type or dictate a short introduction, review
the text and choose “Suggest interests from my intro.” Only then does the server
call Muse. Suggestions remain unapproved until the player saves their interests.
The introduction is an optional alternative to Instagram and keyword entry.

## Browser capture

`src/speech.ts` uses feature detection for SpeechRecognition or
webkitSpeechRecognition in a secure context. It never automatically requests a
microphone or restarts listening. A session stops after 30 seconds, when the player
stops it, when the document is hidden or when the component is removed. It handles
permission denial, missing microphones, silence and connection errors without
clearing typed text. Interim results replace earlier partial results and append
to text that was present when listening began.

Destina does not record, upload or store audio. The browser’s recognition service
may process audio remotely; the page explains this. Browser support varies, so
keyboard dictation and typing are always alternatives. Actual-device microphone
and language testing is still required. Browser behavior is documented at
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition.

## Server boundaries

POST `/api/profile/intro` accepts `{text}` with 10–1,200 trimmed characters and
requires a player session in an unfinished room. Audio is not accepted. The saved
source has kind `intro`, distinct from `bio`, `caption` and manual interest text.
Only its owner receives it through the profile snapshot. The GM feed receives no
intro transcript. Profile resets and finished rooms remove intro sources.

One extraction can run per player at a time. Successful identical submissions
are reused, including across server restarts. A changed introduction replaces
previous unapproved intro suggestions while preserving approved interests and
other sources. Prior intro excerpts remain only when needed to support retained
interests. Text and interests are compared again after extraction; a concurrent
reset is detected through a persisted per-player revision even if the profile was
already empty. Changed profiles are never overwritten by stale extraction results.

The existing Muse request cap, timeout, evidence validation and one-repair bound
apply. Service failure saves the introduction for review and offers manual entry;
it does not invent interests or silently approve any data. The latest introduction
can be edited, and identical saved text is not repeatedly billed by the app.

## Verification

Automated tests cover interim transcript replacement, microphone denial, timed
stop and cleanup, auth and size limits, source grounding, approval boundaries,
private transcript visibility, duplicate-request reuse, model failure and a reset
during an in-flight extraction. Frontend verification must also cover denied mic
permissions and real speech recognition on the intended iOS and Android browsers.

The current onboarding saves extracted suggestions automatically into the top
interest list. Players can remove incorrect interests immediately. The separate
interest-save footer has been removed; voice/text extraction remains an explicit
user action after reviewing the introduction text.
