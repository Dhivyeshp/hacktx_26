import { randomUUID } from "node:crypto";
import { tigerPool } from "./db";

/**
 * The durable Muse request ledger. Reserve before sending: failed or timed out
 * calls can still be billed by the provider.
 *
 * Counted and inserted inside one transaction so two concurrent requests cannot
 * both pass the limit check.
 */
export async function reserveModelRequest() {
  const limit = Number(process.env.MODEL_MAX_REQUESTS || 100);
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new Error("MODEL_MAX_REQUESTS must be a nonnegative integer");
  const client = await tigerPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT count(*)::int AS count FROM model_usage",
    );
    if (rows[0].count >= limit)
      throw new Error("Local Muse request allowance exhausted");
    await client.query("INSERT INTO model_usage VALUES($1,$2)", [
      randomUUID(),
      Date.now(),
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
