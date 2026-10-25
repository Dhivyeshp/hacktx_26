import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Player,
  Source,
  Recommendation,
  Round,
  SuggestionBatch,
  ConversationState,
} from "../shared/types";
export type Session = {
  rewardGameId?: string;
  rewardSuggestions?: import("../shared/rewards").RewardSuggestion[];
  id: string;
  code: string;
  name: string;
  version: number;
  status: "lobby" | "active" | "finished";
  players: Player[];
  recommendations: Recommendation[];
  suggestionBatches?: SuggestionBatch[];
  rounds: Round[];
  context: string;
  sources: Record<string, Source[]>;
  notice?: string;
  profileNotices?: Record<string, string>;
  profileRevisions?: Record<string, number>;
  conversation?: ConversationState;
};
export function openDb(
  path = process.env.DATABASE_PATH || "data/centerpiece.db",
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS credentials(token TEXT PRIMARY KEY,session_id TEXT NOT NULL,player_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS connections(player_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,encrypted_token TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS oauth(state TEXT PRIMARY KEY,player_id TEXT NOT NULL,session_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS questions_invites(token TEXT PRIMARY KEY,session_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS questions_access(token TEXT PRIMARY KEY,session_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,type TEXT NOT NULL,created_at INTEGER NOT NULL,body TEXT NOT NULL);`);
  for (const table of ["questions_invites", "questions_access"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "permission"))
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN permission TEXT NOT NULL DEFAULT 'read'`,
      );
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS audio_tickets(token TEXT PRIMARY KEY,session_id TEXT NOT NULL,expires_at INTEGER NOT NULL,format TEXT NOT NULL)",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS reward_settings(game_id TEXT PRIMARY KEY,goal INTEGER NOT NULL DEFAULT 40,paused INTEGER NOT NULL DEFAULT 0,celebrated INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS reward_reviews(game_id TEXT NOT NULL,round_id TEXT NOT NULL,awards TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(game_id,round_id));
    CREATE TABLE IF NOT EXISTS reward_wallets(player_id TEXT PRIMARY KEY,wallet TEXT UNIQUE NOT NULL,encrypted_secret TEXT NOT NULL,registered INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS reward_jobs(game_id TEXT NOT NULL,round_id TEXT NOT NULL,round_no INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,results TEXT NOT NULL DEFAULT '[]',error TEXT,PRIMARY KEY(game_id,round_id));
    CREATE TABLE IF NOT EXISTS reward_audit(id TEXT PRIMARY KEY,game_id TEXT NOT NULL,round_id TEXT,kind TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL);
  `);
  return db;
}
export type DB = ReturnType<typeof openDb>;
export function save(db: DB, s: Session) {
  db.prepare(
    "INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
  ).run(s.id, s.code, JSON.stringify(s));
}
export function getSession(db: DB, id: string): Session | undefined {
  const row = db
    .prepare("SELECT body FROM sessions WHERE id=? OR code=?")
    .get(id, id.toUpperCase()) as { body: string } | undefined;
  return row ? JSON.parse(row.body) : undefined;
}
export function event(db: DB, s: Session, type: string, body: unknown = {}) {
  db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(
    randomUUID(),
    s.id,
    type,
    Date.now(),
    JSON.stringify(body),
  );
}
