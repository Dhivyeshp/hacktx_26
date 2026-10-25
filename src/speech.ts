export type RecognitionResults = ArrayLike<{
  0: { transcript: string };
  isFinal: boolean;
}>;
export type SpeechEngine = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: RecognitionResults }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type SpeechConstructor = new () => SpeechEngine;
export type SpeechPhase = "idle" | "starting" | "listening";
export function speechConstructor(): SpeechConstructor | undefined {
  const browser = window as unknown as {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };
  return window.isSecureContext
    ? browser.SpeechRecognition || browser.webkitSpeechRecognition
    : undefined;
}
export function speechMessage(error: string) {
  if (["not-allowed", "service-not-allowed"].includes(error))
    return "Microphone access wasn’t allowed. You can type your intro or use your keyboard’s microphone.";
  if (error === "no-speech")
    return "We didn’t catch any speech. Try again, or type your intro.";
  if (error === "audio-capture")
    return "No microphone was available. Try your keyboard’s microphone or type instead.";
  if (error === "network")
    return "Voice input couldn’t connect. Your text is still here. You can type or use keyboard dictation.";
  return "Voice input stopped. You can keep editing your text or try again.";
}
export function transcriptText(initial: string, results: RecognitionResults) {
  return [
    initial.trim(),
    Array.from(results)
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1200);
}
/** One user-started listening session. Never uploads audio to Destina or calls Muse. */
export function beginDictation(
  Engine: SpeechConstructor,
  options: {
    initial: string;
    lang: string;
    onText: (text: string) => void;
    onPhase: (phase: SpeechPhase) => void;
    onError: (message: string) => void;
  },
) {
  const engine = new Engine();
  let active = true;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    engine.onstart = engine.onresult = engine.onerror = engine.onend = null;
    options.onPhase("idle");
  };
  const cancel = () => {
    finish();
    try {
      engine.abort();
    } catch {}
  };
  const stop = () => {
    if (!active || stopping) return;
    stopping = true;
    clearTimeout(timer);
    try {
      engine.stop();
      if (active) timer = setTimeout(cancel, 2000);
    } catch {
      cancel();
    }
  };
  engine.lang = options.lang;
  engine.continuous = true;
  engine.interimResults = true;
  engine.onstart = () => {
    if (!active) return;
    clearTimeout(timer);
    options.onPhase("listening");
    timer = setTimeout(stop, 30000);
  };
  engine.onresult = (event) => {
    if (active) options.onText(transcriptText(options.initial, event.results));
  };
  engine.onerror = (event) => {
    if (!active) return;
    options.onError(speechMessage(event.error));
    cancel();
  };
  engine.onend = finish;
  options.onPhase("starting");
  timer = setTimeout(() => {
    options.onError(
      "Voice input didn’t start. You can type or use your keyboard’s microphone.",
    );
    cancel();
  }, 15000);
  try {
    engine.start();
  } catch {
    options.onError(speechMessage("start"));
    cancel();
  }
  return { stop, cancel };
}
