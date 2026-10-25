import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, LoaderCircle, Check } from "lucide-react";
import { beginDictation, speechConstructor, type SpeechPhase } from "./speech";

export function VoiceIntro({
  savedText,
  busy,
  onSave,
  hasInterests,
}: {
  savedText: string;
  busy: boolean;
  onSave: (text: string) => Promise<boolean>;
  hasInterests: boolean;
}) {
  const [text, setText] = useState(savedText);
  const [phase, setPhase] = useState<SpeechPhase>("idle");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(!hasInterests);
  const control = useRef<ReturnType<typeof beginDictation> | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const supported = !!speechConstructor();
  const listening = phase !== "idle";
  useEffect(() => {
    setText(savedText);
  }, [savedText]);
  useEffect(
    () => () => {
      control.current?.cancel();
    },
    [],
  );
  useEffect(() => {
    const hide = () => {
      if (document.hidden) control.current?.cancel();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  function dictate() {
    const Engine = speechConstructor();
    if (!Engine) {
      input.current?.focus();
      return;
    }
    setMessage("");
    try {
      control.current = beginDictation(Engine, {
        initial: text,
        lang: document.documentElement.lang || navigator.language || "en-US",
        onText: setText,
        onPhase: setPhase,
        onError: setMessage,
      });
    } catch {
      setPhase("idle");
      setMessage(
        "Voice input isn’t available here. You can type or use your keyboard’s microphone.",
      );
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      await onSave(text.trim());
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section className="panel intro-panel" aria-labelledby="intro-heading">
      <h2 id="intro-heading">In your own words.</h2>
      <p>A short intro is another way to find your interests.</p>
      {!open ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          {savedText ? "Edit your introduction" : "Add a voice or text intro"}
        </button>
      ) : (
        <>
          <p className="intro-cue">
            What have you been into lately? Anything you’re making, learning or
            looking forward to?
          </p>
          <form onSubmit={submit}>
            <label htmlFor="profile-intro">Your introduction</label>
            <textarea
              ref={input}
              id="profile-intro"
              rows={4}
              maxLength={1200}
              value={text}
              disabled={busy || listening}
              onChange={(e) => setText(e.target.value)}
              placeholder="I’m learning pottery and making a little hiking app…"
              aria-describedby="intro-input-help"
            />
            <div className="intro-voice-controls">
              {listening ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => control.current?.stop()}
                >
                  <Square size={15} />
                  Stop listening
                </button>
              ) : supported ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || text.length >= 1200}
                  onClick={dictate}
                >
                  <Mic size={17} />
                  Use my voice
                </button>
              ) : null}
              <span className="intro-count">{text.length}/1200</span>
            </div>
            <p id="intro-input-help" className="intro-help">
              {supported
                ? "Speak for up to 30 seconds, then check the text. You can type here too."
                : "Type here, or tap the microphone on your phone’s keyboard to dictate."}
            </p>
            <p className="intro-status" role="status" aria-live="polite">
              {phase === "starting"
                ? "Waiting for microphone access…"
                : phase === "listening"
                  ? "Listening. Stop when you’re ready."
                  : message ||
                    (text && text.trim() === savedText
                      ? "Introduction saved. Your interests update above."
                      : "")}
            </p>
            <button
              type="submit"
              className="secondary full"
              disabled={
                busy ||
                listening ||
                text.trim().length < 10 ||
                text.trim() === savedText
              }
            >
              {submitting ? (
                <>
                  <LoaderCircle className="spin" size={16} />
                  Finding interests…
                </>
              ) : text.trim() && text.trim() === savedText ? (
                <>
                  <Check size={16} />
                  Introduction saved
                </>
              ) : (
                "Suggest interests from my intro"
              )}
            </button>
          </form>
          <details className="intro-privacy">
            <summary>About voice input</summary>
            <p>
              Your browser may process speech online. Destina receives the text,
              not an audio recording. Text is sent to Muse only when you ask for
              suggestions. Your introduction stays private to your profile and
              is cleared when you reset it or the room closes.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
