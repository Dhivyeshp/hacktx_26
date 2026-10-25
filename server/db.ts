import pg from "pg";
import { randomUUID } from "node:crypto";
import type {
  Player,
  Source,
  Recommendation,
  Round,
  SuggestionBatch,
  ConversationState,
} from "../shared/types";

/**
 * TigerDB (TimescaleDB) is the only store. Game state, credentials, the Game
 * Master's access grants and the transcript all live here; there is no local
 * database file any more.
 *
 * Epoch milliseconds are kept in bigint columns so the comparisons in the rest
 * of the server stay exactly as they were. pg hands bigint back as a string by
 * default, which would silently break every one of those comparisons.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

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

export type Statement = {
  get<T = any>(...params: unknown[]): Promise<T | undefined>;
  all<T = any>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<{ changes: number }>;
};

export type DB = {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  /** Runs `work` inside a single transaction. Use the handle it is given. */
  transaction<T>(work: (tx: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/**
 * The game tables. Statement text is shared with scripts/tigerdb-migrate.ts so
 * a migration and a server start can never disagree about the shape.
 *
 * Session and award bodies stay as text: the server compares round-tripped JSON
 * against in-memory JSON to detect concurrent edits, and jsonb would normalise
 * key order out from under those comparisons. Write-only audit bodies are json.
 */
export const gameSchema = [
  `CREATE TABLE IF NOT EXISTS sessions(
     id   text PRIMARY KEY,
     code text UNIQUE NOT NULL,
     body text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS credentials(
     token      text PRIMARY KEY,
     session_id text NOT NULL,
     player_id  text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS connections(
     player_id       text   PRIMARY KEY,
     session_id      text   NOT NULL,
     encrypted_token text   NOT NULL,
     expires_at      bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS oauth(
     state      text   PRIMARY KEY,
     player_id  text   NOT NULL,
     session_id text   NOT NULL,
     expires_at bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS questions_invites(
     token      text   PRIMARY KEY,
     session_id text   NOT NULL,
     expires_at bigint NOT NULL,
     permission text   NOT NULL DEFAULT 'read'
   )`,
  `CREATE TABLE IF NOT EXISTS questions_access(
     token      text   PRIMARY KEY,
     session_id text   NOT NULL,
     expires_at bigint NOT NULL,
     permission text   NOT NULL DEFAULT 'read'
   )`,
  `ALTER TABLE questions_invites ADD COLUMN IF NOT EXISTS permission text NOT NULL DEFAULT 'read'`,
  `ALTER TABLE questions_access  ADD COLUMN IF NOT EXISTS permission text NOT NULL DEFAULT 'read'`,
  `CREATE TABLE IF NOT EXISTS events(
     id         text   PRIMARY KEY,
     session_id text   NOT NULL,
     type       text   NOT NULL,
     created_at bigint NOT NULL,
     body       json   NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS events_session_time ON events (session_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS audio_tickets(
     token      text   PRIMARY KEY,
     session_id text   NOT NULL,
     expires_at bigint NOT NULL,
     format     text   NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS audio_minutes(
     id         text   PRIMARY KEY,
     session_id text   NOT NULL,
     at         bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS game_model_attempts(
     id         text   PRIMARY KEY,
     session_id text   NOT NULL,
     at         bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS model_usage(
     id text   PRIMARY KEY,
     at bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS reward_settings(
     game_id    text    PRIMARY KEY,
     goal       integer NOT NULL DEFAULT 40,
     paused     integer NOT NULL DEFAULT 0,
     celebrated integer NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS reward_reviews(
     game_id    text   NOT NULL,
     round_id   text   NOT NULL,
     awards     text   NOT NULL,
     updated_at bigint NOT NULL,
     PRIMARY KEY(game_id, round_id)
   )`,
  `CREATE TABLE IF NOT EXISTS reward_wallets(
     player_id        text    PRIMARY KEY,
     wallet           text    UNIQUE NOT NULL,
     encrypted_secret text    NOT NULL,
     registered       integer NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS reward_jobs(
     game_id  text    NOT NULL,
     round_id text    NOT NULL,
     round_no integer NOT NULL,
     state    text    NOT NULL,
     payload  text    NOT NULL,
     results  text    NOT NULL DEFAULT '[]',
     error    text,
     PRIMARY KEY(game_id, round_id)
   )`,
  `CREATE TABLE IF NOT EXISTS reward_audit(
     id       text   PRIMARY KEY,
     game_id  text   NOT NULL,
     round_id text,
     kind     text   NOT NULL,
     body     json   NOT NULL,
     at       bigint NOT NULL
   )`,
];

/** Never log the connection string, the host, or a raw driver error. */
export function tigerConnectionString() {
  const value = process.env.TIGER_DATABASE_URL;
  if (!value)
    throw new Error(
      "Set TIGER_DATABASE_URL. Destina keeps all of its state in TigerDB.",
    );
  return value;
}

export function createPool(max = Number(process.env.TIGER_POOL_MAX) || 8) {
  const pool = new pg.Pool({
    connectionString: tigerConnectionString(),
    ssl:
      process.env.TIGER_SSL_MODE === "disable"
        ? undefined
        : { rejectUnauthorized: true },
    max,
    connectionTimeoutMillis: 10000,
  });
  // A pool-level listener keeps a dropped backend from taking down Node.
  pool.on("error", () => console.warn("[tigerdb] pool failed"));
  return pool;
}

let shared: pg.Pool | undefined;

/** One pool per process, shared with the transcript reader in tigerdb.ts. */
export function tigerPool() {
  return (shared ??= createPool());
}

/** The server's SQL is written with `?`; Postgres wants `$1`, `$2`, ... */
function positional(sql: string) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

type Runner = (sql: string, params: unknown[]) => Promise<pg.QueryResult<any>>;

/**
 * An empty values array still puts pg on the extended protocol, which rejects
 * the multi-statement text that `exec` passes in.
 */
const runner =
  (on: { query: pg.Pool["query"] }): Runner =>
  (sql, params) =>
    params.length ? on.query(sql, params) : on.query(sql);

function handle(
  run: Runner,
  begin: DB["transaction"],
  close: () => Promise<void>,
): DB {
  return {
    prepare(sql) {
      const text = positional(sql);
      return {
        get: async (...params) => (await run(text, params)).rows[0],
        all: async (...params) => (await run(text, params)).rows,
        run: async (...params) => ({
          changes: (await run(text, params)).rowCount ?? 0,
        }),
      };
    },
    exec: async (sql) => void (await run(sql, [])),
    transaction: begin,
    close,
  };
}

export async function openDb(pool = tigerPool()): Promise<DB> {
  const db = handle(
    runner(pool),
    async (work) => {
      const client = await pool.connect();
      const run = runner(client as unknown as { query: pg.Pool["query"] });
      // Nested calls join the open transaction rather than opening a second one.
      const tx: DB = handle(
        run,
        (inner) => inner(tx),
        async () => {},
      );
      try {
        await client.query("BEGIN");
        const result = await work(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async () => {
      if (pool === shared) shared = undefined;
      await pool.end();
    },
  );
  for (const statement of gameSchema) await db.exec(statement);
  return db;
}

export async function save(db: DB, s: Session) {
  await db
    .prepare(
      "INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,body=excluded.body",
    )
    .run(s.id, s.code, JSON.stringify(s));
}

export async function getSession(
  db: DB,
  id: string,
): Promise<Session | undefined> {
  const row = await db
    .prepare("SELECT body FROM sessions WHERE id=? OR code=?")
    .get<{ body: string }>(id, id.toUpperCase());
  return row ? JSON.parse(row.body) : undefined;
}

export async function event(
  db: DB,
  s: Session,
  type: string,
  body: unknown = {},
) {
  await db
    .prepare("INSERT INTO events VALUES(?,?,?,?,?)")
    .run(randomUUID(), s.id, type, Date.now(), JSON.stringify(body));
}
