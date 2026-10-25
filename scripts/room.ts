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
  `Room: ${room.name}\nRoom code: ${room.code}\nTina QR destination: ${base}/join/${room.code}\nAll relic tags: ${base}/relic\nQuestion feed: ${base}/questions?room=${room.code}`,
);
db.close();
