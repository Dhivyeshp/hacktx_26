import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Reserve before sending: failed/timeout calls can still be billed by the provider.
export function reserveModelRequest() {
  const path = process.env.MODEL_USAGE_PATH || "data/model-usage.db";
  const limit = Number(process.env.MODEL_MAX_REQUESTS || 100);
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new Error("MODEL_MAX_REQUESTS must be a nonnegative integer");
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY, at INTEGER NOT NULL)",
    );
    db.transaction(() => {
      const { count } = db
        .prepare("SELECT count(*) AS count FROM usage")
        .get() as { count: number };
      if (count >= limit)
        throw new Error("Local Muse request allowance exhausted");
      db.prepare("INSERT INTO usage(at) VALUES(?)").run(Date.now());
    }).immediate();
  } finally {
    db.close();
  }
}
