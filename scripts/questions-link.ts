import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { openDb, getSession } from "../server/db";
import { questionsAccess } from "../server/questions-access";
const code = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!code)
  throw new Error("Usage: npm run questions:link -- ROOM [--control] [--file]");
const db = await openDb();
try {
  const room = await getSession(db, code);
  if (!room) throw new Error("Room not found.");
  const { url } = await questionsAccess(
    db,
    room,
    process.argv.includes("--control") ? "control" : "read",
  );
  if (process.argv.includes("--file")) {
    mkdirSync("data", { recursive: true });
    writeFileSync("data/questions-access-link.txt", url + "\n", {
      mode: 0o600,
    });
    console.log(
      "Private link saved in data/questions-access-link.txt. It can be opened once within 10 minutes.",
    );
  } else
    console.log(
      `Private Game Master link (one use, expires in 10 minutes)\n${url}`,
    );
} finally {
  await db.close();
}
