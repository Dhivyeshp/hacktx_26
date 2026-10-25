# Live conversation testing

Open a room's private GM link with control permission. Create one with
`npm run questions:link -- ROOM --control --file`, then open the URL saved in
`data/questions-access-link.txt`. Keep that link private. Default links are read-only.

## Opening the deployed Game Master

Bookmark `https://your-domain/gm` after signing in. `/questions` remains supported.
The private cookie restores the room for 12 hours; it is separate from player
login. A room code alone never grants GM access.

On an already authorized GM screen, expand Open on another device and select
Create private access link. Copy it to your own device, or open the deployed GM
there. Each link works once within 10 minutes and grants control for this room.
Keep it out of public QR codes and player messages. If access expires, create a
fresh link from an authorized screen or the local CLI, or sign in with the GM key.

The workspace shows current selection, next options, live transcript, voice
confirmation and players together. Desktop uses two columns; phone shortcuts
jump between sections without interrupting recording. Generating prompts and
speaker confirmation are unchanged by this layout.

## A first test

1. Join at least three players and save their interests.
2. Use the question library for a free rehearsal, or request three Muse prompts.
3. Choose a prompt, optionally edit its wording, and open `/prompt` on a joined phone.
4. In Live conversation, confirm everyone agrees to transcription and select Listen on this device. HTTPS and microphone permission are required.
5. Let the assigned player answer a solo prompt. When a voice hint appears, confirm the name or keep it unknown. Correct labels with the speaker dropdowns.
6. Mark the prompt completed or passed. After at least 40 new transcript words, prepare conversation prompts. Selecting a prompt never identifies a voice automatically.

The pasted-conversation tool rehearses transcript and speaker controls without a
microphone or transcription charge. Its entries are explicitly labeled test text.
The question library costs no Muse requests. Leave automatic preparation off for
manual spending control.

## Audio and names

Set `DEEPGRAM_API_KEY` on the server, then restart. Audio travels through a
dedicated authenticated WebSocket to Deepgram. Destina stores final transcript
text, not raw audio. The browser stops its capture on pause, leaving the tab,
closing private access or a connection failure. It never silently reconnects.
Pause while Tina reads aloud to avoid transcribing playback.

Deepgram separates voices; it does not know player names. A solo prompt offers a
tentative name for the GM to confirm. Overlaps, interruptions and another person
answering can make that guess wrong. Unknown voices stay unknown. Speaker labels
are scoped to a recording connection, so reconnects require confirmation again.
Profile introductions store text only and do not enroll voiceprints.

## Tina microphone adapter

Prepare a Tina connection in the GM Conversation view. Copy its one-use ticket
to Tina as `TINA_AUDIO_TICKET`; it expires after 60 seconds. Set `PUBLIC_URL` to
the app's HTTPS origin. Pipe signed 16-bit little-endian mono PCM at 16 kHz:

```sh
arecord -f S16_LE -r 16000 -c 1 -t raw | npm run tina:audio -- ROOMCODE
```

Install this repository's Node dependencies on the machine running the adapter.
Alternatively a trusted adapter with `GM_API_KEY` can obtain tickets by running
`npm run tina:audio -- ROOMCODE --consent`. Confirm consent before doing so.
Never put the Deepgram key on Tina. Ctrl+C ends capture. This adapter still needs
testing with Tina's actual microphone; it is separate from the Vision Pro relay.

## Spending and retention

- `GAME_MODEL_MAX_REQUESTS` defaults to 12 question-generation attempts per room, including repair attempts. The existing global model cap also applies. Profile extraction uses the global allowance separately.
- Conversation requests include a saved summary and at most 60 recent segments, bounded to 7,000 characters. One repair attempt is allowed. Each turn permits one conversation batch, requiring 40 new words.
- Polling, audio chunks, speaker confirmation and transcript updates never call Muse. Optional automatic preparation only runs between completed/passed turns.
- `DEEPGRAM_MAX_MINUTES` defaults to 30 started streaming minutes per room. Reservations persist across restarts. This conservative counter is not the provider's exact billed usage or a dollar cap.
- Only the latest 400 transcript segments are retained. Clear transcript removes transcript, summary and voice mappings. Ending the session removes conversation and imported profile text. Previously generated prompt history remains.

Outcomes remain human-confirmed. Voice attribution is not used for automatic
currency payouts. Real microphone quality, overlapping speech and the complete
Tina/Vision Pro hardware loop require an in-person test.
