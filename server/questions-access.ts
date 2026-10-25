import { randomBytes } from "node:crypto";
import { tokenHash } from "./security";
import type { DB, Session } from "./db";

export async function questionsAccess(
  db: DB,
  room: Session,
  permission: "read" | "control" = "read",
) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await db
    .prepare("DELETE FROM questions_invites WHERE expires_at<?")
    .run(Date.now());
  await db
    .prepare(
      "INSERT INTO questions_invites(token,session_id,expires_at,permission) VALUES(?,?,?,?)",
    )
    .run(tokenHash(token), room.id, expiresAt, permission);
  const path = `/questions?room=${room.code}#access=${token}`;
  return {
    path,
    url: `${process.env.PUBLIC_URL || "http://localhost:3000"}${path}`,
    expiresAt,
  };
}
