import { test } from "node:test";
import assert from "node:assert/strict";
import { importSummary, interestLabel } from "../src/profile-copy";
import type { Source } from "../shared/types";
const bio: Source = { id: "bio", kind: "bio", text: "A bio" };
const caption: Source = { id: "caption", kind: "caption", text: "A caption" };
test("import summaries report only available content with proper plurals", () => {
  assert.equal(
    importSummary([bio, caption]),
    "We found your bio and 1 caption.",
  );
  assert.equal(
    importSummary([bio, caption, { ...caption, id: "other" }]),
    "We found your bio and 2 captions.",
  );
  assert.equal(importSummary([bio]), "We found your bio.");
  assert.equal(importSummary([caption]), "We found 1 caption.");
  assert.equal(importSummary([]), "Your imported profile is saved.");
});
test("interest labels use sentence case without flattening mixed-case names", () => {
  assert.equal(interestLabel("climbing"), "Climbing");
  assert.equal(interestLabel("SOFTWARE ENGINEERING"), "Software engineering");
  assert.equal(interestLabel("AI research"), "AI research");
  assert.equal(interestLabel("  Photography  "), "Photography");
});
