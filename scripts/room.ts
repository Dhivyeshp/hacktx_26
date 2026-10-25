import "dotenv/config";
import { openDb } from "../server/db";
import { createRoom } from "../server/rooms";
const db = openDb();
const room = createRoom(
  db,
  process.argv.slice(2).join(" ") || "The midnight gathering",
);
const base = process.env.PUBLIC_URL || "http://localhost:3000";
console.log(
  `Room: ${room.name}\nRoom code: ${room.code}\nBot QR destination: ${base}/join/${room.code}\nAll capsule chips: ${base}/c`,
);
db.close();
