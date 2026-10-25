import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveModelRequest } from "../server/model-budget";

test("Muse request allowance persists across connections and fails closed at its cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "kindred-budget-"));
  const oldPath = process.env.MODEL_USAGE_PATH;
  const oldLimit = process.env.MODEL_MAX_REQUESTS;
  try {
    process.env.MODEL_USAGE_PATH = join(dir, "usage.db");
    process.env.MODEL_MAX_REQUESTS = "2";
    reserveModelRequest();
    reserveModelRequest();
    assert.throws(() => reserveModelRequest(), /allowance exhausted/);
    process.env.MODEL_MAX_REQUESTS = "invalid";
    assert.throws(() => reserveModelRequest(), /nonnegative integer/);
    process.env.MODEL_MAX_REQUESTS = "0";
    assert.throws(() => reserveModelRequest(), /allowance exhausted/);
  } finally {
    if (oldPath === undefined) delete process.env.MODEL_USAGE_PATH;
    else process.env.MODEL_USAGE_PATH = oldPath;
    if (oldLimit === undefined) delete process.env.MODEL_MAX_REQUESTS;
    else process.env.MODEL_MAX_REQUESTS = oldLimit;
    rmSync(dir, { recursive: true, force: true });
  }
});
