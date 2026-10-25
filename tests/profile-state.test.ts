import { test } from "node:test";
import assert from "node:assert/strict";
import { interestSelectionChanged } from "../src/profile-state";
const kept = { id: "kept", label: "Climbing", approved: true, sourceIds: [] };
const pending = {
  id: "pending",
  label: "Cooking",
  approved: false,
  sourceIds: [],
};
test("rejecting an imported suggestion remains saveable even when approved interests are unchanged", () => {
  assert.equal(interestSelectionChanged([kept, pending], ["kept"], []), true);
  assert.equal(interestSelectionChanged([kept], ["kept"], []), false);
  assert.equal(interestSelectionChanged([kept], [], []), true);
  assert.equal(interestSelectionChanged([kept], ["kept"], ["Pottery"]), true);
});
