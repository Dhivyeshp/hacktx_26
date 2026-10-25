import { randomBytes } from "node:crypto";
import { tokenHash } from "./security";
import type { DB, Session } from "./db";

export function questionsAccess(db: DB, room: Session) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  db.prepare("DELETE FROM questions_invites WHERE expires_at<?").run(
    Date.now(),
  );
  db.prepare("INSERT INTO questions_invites VALUES(?,?,?)").run(
    tokenHash(token),
    room.id,
    expiresAt,
  );
  const path = `/questions?room=${room.code}#access=${token}`;
  return {
    path,
    url: `${process.env.PUBLIC_URL || "http://localhost:3000"}${path}`,
    expiresAt,
  };
}
