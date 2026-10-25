import { test } from "node:test";
import assert from "node:assert/strict";
import { deepgramSegments } from "../server/audio";

const result = {
  type: "Results",
  is_final: true,
  start: 0,
  channel: {
    alternatives: [
      {
        transcript: "Hello there.",
        confidence: 0.99,
        words: [
          { word: "Hello", speaker: 0 },
          { punctuated_word: "there.", speaker: 0 },
        ],
      },
    ],
  },
};
test("only final confident transcripts are split into anonymous speaker segments", () => {
  assert.deepEqual(
    deepgramSegments({ ...result, is_final: false }, "stream", 0),
    [],
  );
  const segments = deepgramSegments(result, "stream-123456789", 0);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "Hello there.");
  assert.equal(segments[0].speakerLabel, "stream-1-speaker-1");
  assert.deepEqual(
    deepgramSegments(
      {
        type: "Results",
        is_final: true,
        channel: { alternatives: [{ transcript: "Noise", confidence: 0.1 }] },
      },
      "stream",
      0,
    ),
    [],
  );
});
