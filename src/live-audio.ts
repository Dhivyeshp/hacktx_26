export type AudioHandle = { stop: () => void };
export async function captureRoomAudio(
  ticket: { token: string; path: string },
  onStatus: (state: string) => void,
  onError: (message: string) => void,
  isCancelled: () => boolean = () => false,
): Promise<AudioHandle> {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      "Microphone streaming is unavailable in this browser. Try a current phone browser or transcript testing.",
    );
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType)
    throw new Error(
      "This browser’s audio format is unsupported. Use another browser or transcript testing.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  if (isCancelled() || document.hidden) {
    stream.getTracks().forEach((track) => track.stop());
    throw new DOMException("Cancelled", "AbortError");
  }
  let ws: WebSocket;
  try {
    const url = new URL(ticket.path, location.origin);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(url);
  } catch (e) {
    stream.getTracks().forEach((track) => track.stop());
    throw e;
  }
  let recorder: MediaRecorder | undefined,
    ended = false;
  const timer = setTimeout(() => {
    onError("The audio connection timed out. Try again.");
    stop();
  }, 15000);
  function stop() {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", hidden);
    if (recorder?.state === "recording") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "stop" }));
    ws.close();
    onStatus("idle");
  }
  function hidden() {
    if (document.hidden) stop();
  }
  document.addEventListener("visibilitychange", hidden);
  stream.getAudioTracks().forEach((track) => (track.onended = stop));
  ws.onopen = () => {
    if (!ended) ws.send(JSON.stringify({ type: "auth", token: ticket.token }));
  };
  ws.onmessage = (event) => {
    if (ended) return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === "error") {
        onError(message.message || "Could not start audio.");
        stop();
        return;
      }
      if (message.type !== "ready") return;
      clearTimeout(timer);
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (!ended && event.data.size && ws.readyState === WebSocket.OPEN) {
          if (ws.bufferedAmount > 512 * 1024) {
            onError("Audio connection is too slow. Listening stopped.");
            stop();
          } else ws.send(event.data);
        }
      };
      recorder.onerror = () => {
        onError("Microphone recording failed. Try again.");
        stop();
      };
      recorder.start(750);
      onStatus("listening");
    } catch {
      onError("Could not read the audio connection response.");
      stop();
    }
  };
  ws.onerror = () => {
    onError(
      "The transcription connection failed. Check the key and connection.",
    );
    stop();
  };
  ws.onclose = () => stop();
  return { stop };
}
