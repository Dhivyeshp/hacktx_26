import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "../server/security";
import { importProfile, exchange } from "../server/instagram";

test("encrypted Instagram tokens resist tampering", () => {
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  const token = encrypt("private-token");
  assert.ok(!token.includes("private-token"));
  assert.equal(decrypt(token), "private-token");
  const bytes = Buffer.from(token, "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decrypt(bytes.toString("base64")));
});
test("missing Instagram fields remain missing; consumer accounts are rejected", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input: any) => {
      const u = String(input);
      return Response.json(
        u.includes("fields=user_id")
          ? { user_id: "ig1", username: "example" }
          : u.includes("fields=account_type")
            ? { account_type: "BUSINESS" }
            : u.includes("/media")
              ? { data: [] }
              : { error: { message: "Unsupported field" } },
        { status: u.includes("biography") ? 400 : 200 },
      );
    };
    const r = await importProfile("test");
    assert.deepEqual(r.sources, []);
    assert.ok(r.unavailable.includes("biography"));
    globalThis.fetch = async (input: any) =>
      Response.json(
        String(input).includes("fields=user_id")
          ? { user_id: "ig1" }
          : { account_type: "PERSONAL" },
      );
    await assert.rejects(() => importProfile("test"), /Only Business/);
  } finally {
    globalThis.fetch = original;
  }
});
test("expired Instagram tokens and exchange failures are recoverable", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ error: { message: "Expired" } }, { status: 401 });
    await assert.rejects(() => importProfile("expired"));
    await assert.rejects(() => exchange("bad"));
  } finally {
    globalThis.fetch = original;
  }
});
