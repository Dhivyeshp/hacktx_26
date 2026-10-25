/**
 * Creates the TigerDB (TimescaleDB) transcript schema. Idempotent.
 *
 *   npm run tigerdb:migrate      create the hypertable and continuous aggregate
 *   npm run tigerdb:check        print row counts as evidence the store is live
 *
 * Requires TIGER_DATABASE_URL. Never prints the connection string.
 */
import "dotenv/config";
import { Pool } from "pg";

const statements = [
  `CREATE EXTENSION IF NOT EXISTS timescaledb`,
  `CREATE TABLE IF NOT EXISTS transcript_segments (
     at            timestamptz NOT NULL,
     room_id       text        NOT NULL,
     segment_id    text        NOT NULL,
     sequence      bigint,
     round_id      text,
     speaker_label text,
     speaker_id    text,
     origin        text        NOT NULL,
     word_count    integer     NOT NULL,
     text          text        NOT NULL,
     PRIMARY KEY (room_id, segment_id, at)
   )`,
  `SELECT create_hypertable('transcript_segments', 'at', if_not_exists => TRUE)`,
  `CREATE INDEX IF NOT EXISTS transcript_room_time
     ON transcript_segments (room_id, at DESC)`,
  `CREATE MATERIALIZED VIEW IF NOT EXISTS speaker_activity_minute
   WITH (timescaledb.continuous) AS
   SELECT time_bucket('1 minute', at) AS bucket,
          room_id,
          speaker_label,
          count(*)        AS segments,
          sum(word_count) AS words
     FROM transcript_segments
    GROUP BY bucket, room_id, speaker_label
   WITH NO DATA`,
];

const policy = `SELECT add_continuous_aggregate_policy('speaker_activity_minute',
  start_offset => INTERVAL '1 hour',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE)`;

function pool() {
  const connectionString = process.env.TIGER_DATABASE_URL;
  if (!connectionString) {
    console.error(
      "Set TIGER_DATABASE_URL before running the TigerDB migration.",
    );
    process.exit(1);
  }
  return new Pool({
    connectionString,
    ssl:
      process.env.TIGER_SSL_MODE === "disable"
        ? undefined
        : { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10000,
  });
}

async function migrate() {
  const db = pool();
  try {
    for (const statement of statements) {
      await db.query(statement);
      console.log("ok  " + statement.trim().split("\n")[0]);
    }
    // Refresh policies are a licensed feature on some plans. A failure here
    // leaves a working view that simply needs a manual refresh.
    try {
      await db.query(policy);
      console.log("ok  continuous aggregate refresh policy");
    } catch {
      console.log(
        "skip continuous aggregate refresh policy, refresh manually with CALL refresh_continuous_aggregate('speaker_activity_minute', NULL, NULL)",
      );
    }
    console.log("TigerDB transcript schema is ready.");
  } finally {
    await db.end();
  }
}

async function check() {
  const db = pool();
  try {
    const rows = await db.query(
      `SELECT room_id, count(*)::int AS segments, sum(word_count)::int AS words,
              min(at) AS first_at, max(at) AS last_at
         FROM transcript_segments GROUP BY room_id ORDER BY segments DESC`,
    );
    const chunks = await db.query(
      `SELECT count(*)::int AS n FROM timescaledb_information.chunks
        WHERE hypertable_name = 'transcript_segments'`,
    );
    console.log(`hypertable chunks: ${chunks.rows[0]?.n ?? 0}`);
    if (!rows.rowCount) console.log("No transcript rows recorded yet.");
    for (const row of rows.rows)
      console.log(
        `${row.room_id}  ${row.segments} segments  ${row.words} words  ${new Date(row.first_at).toISOString()} to ${new Date(row.last_at).toISOString()}`,
      );
  } finally {
    await db.end();
  }
}

(process.argv.includes("--check") ? check() : migrate()).catch(() => {
  console.error(
    "TigerDB command failed. Check TIGER_DATABASE_URL, network access and that the service has TimescaleDB enabled.",
  );
  process.exit(1);
});
