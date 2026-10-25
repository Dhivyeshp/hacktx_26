import "dotenv/config";
import WebSocket from "ws";
const room = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!room)
  throw new Error(
    "Usage: npm run tina:audio -- ROOM. Pipe signed 16-bit little-endian mono PCM at 16 kHz into stdin.",
  );
const base = process.env.PUBLIC_URL || "http://localhost:3000";
let token = process.env.TINA_AUDIO_TICKET?.trim();
if (!token) {
  if (!process.argv.includes("--consent"))
    throw new Error(
      "Confirm everyone agrees to transcription, then add --consent.",
    );
  const key = process.env.GM_API_KEY;
  if (!key)
    throw new Error(
      "Supply a one-use TINA_AUDIO_TICKET, or run this trusted adapter with GM_API_KEY configured. Never use the Deepgram key on Tina.",
    );
  const response = await fetch(
    `${base}/api/control/rooms/${encodeURIComponent(room)}/audio-ticket`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ consent: true, format: "linear16" }),
    },
  );
  if (!response.ok)
    throw new Error(
      "Could not obtain an audio ticket. Confirm consent, room code and server configuration.",
    );
  token = ((await response.json()) as { token: string }).token;
}
const url = new URL("/api/audio", base);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(url);
process.stdin.pause();
let done = false;
function stop() {
  if (done) return;
  done = true;
  process.stdin.pause();
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: "stop" }));
  socket.close();
}
socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token })));
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "error") {
    console.error(message.message);
    process.exitCode = 1;
    stop();
  }
  if (message.type === "ready") {
    console.log(
      "Tina audio connected. Raw audio is not stored by Destina. Press Ctrl+C to stop.",
    );
    process.stdin.on("data", (chunk) => {
      if (socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 512 * 1024) {
          console.error("Audio connection too slow.");
          stop();
        } else socket.send(chunk, { binary: true });
      }
    });
    process.stdin.on("end", stop);
    process.stdin.resume();
  }
});
socket.on("error", () => {
  console.error("Audio connection failed.");
  process.exitCode = 1;
  stop();
});
socket.on("close", () => {
  done = true;
  process.stdin.pause();
  process.stdin.destroy();
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
