import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginDictation,
  transcriptText,
  type SpeechEngine,
  type SpeechPhase,
} from "../src/speech";
class FakeEngine implements SpeechEngine {
  static last: FakeEngine;
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: SpeechEngine["onstart"] = null;
  onresult: SpeechEngine["onresult"] = null;
  onerror: SpeechEngine["onerror"] = null;
  onend: SpeechEngine["onend"] = null;
  stops = 0;
  aborts = 0;
  constructor() {
    FakeEngine.last = this;
  }
  start() {}
  stop() {
    this.stops++;
  }
  abort() {
    this.aborts++;
  }
}
test("dictation replaces interim results without duplicating speech and preserves typed text", () => {
  const phases: SpeechPhase[] = [];
  const texts: string[] = [];
  const control = beginDictation(FakeEngine, {
    initial: "I like hiking.",
    lang: "en-US",
    onPhase: (p) => phases.push(p),
    onText: (t) => texts.push(t),
    onError: () => assert.fail("unexpected speech error"),
  });
  const engine = FakeEngine.last;
  engine.onstart?.();
  engine.onresult?.({
    results: [{ 0: { transcript: "And pot" }, isFinal: false }],
  });
  engine.onresult?.({
    results: [{ 0: { transcript: "And pottery." }, isFinal: true }],
  });
  assert.deepEqual(texts, [
    "I like hiking. And pot",
    "I like hiking. And pottery.",
  ]);
  assert.deepEqual(phases, ["starting", "listening"]);
  control.stop();
  assert.equal(engine.stops, 1);
  engine.onend?.();
  assert.equal(phases.at(-1), "idle");
  assert.equal(engine.onresult, null);
  assert.equal(transcriptText("x".repeat(1300), []).length, 1200);
});
test("denied microphone access returns to editable text and releases recognition", () => {
  const errors: string[] = [];
  const phases: SpeechPhase[] = [];
  beginDictation(FakeEngine, {
    initial: "",
    lang: "en",
    onPhase: (p) => phases.push(p),
    onText: () => assert.fail("No transcript expected"),
    onError: (m) => errors.push(m),
  });
  FakeEngine.last.onerror?.({ error: "not-allowed" });
  assert.match(errors[0], /wasn’t allowed/);
  assert.equal(phases.at(-1), "idle");
  assert.equal(FakeEngine.last.aborts, 1);
  assert.equal(FakeEngine.last.onresult, null);
});
test("dictation stops at 30 seconds and cleanup ignores late results", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const control = beginDictation(FakeEngine, {
    initial: "",
    lang: "en",
    onPhase: () => {},
    onText: () => assert.fail("late result"),
    onError: () => {},
  });
  const engine = FakeEngine.last;
  engine.onstart?.();
  t.mock.timers.tick(30000);
  assert.equal(engine.stops, 1);
  t.mock.timers.tick(2000);
  assert.equal(engine.aborts, 1);
  assert.equal(engine.onresult, null);
  control.cancel();
  assert.equal(engine.onresult, null);
});
