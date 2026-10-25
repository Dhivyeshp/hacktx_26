import { tigerPool } from "./db";
import type { TranscriptSegment } from "../shared/types";

/**
 * The transcript view of TigerDB (TimescaleDB).
 *
 * Game state and the transcript now share one store, so this module no longer
 * owns a connection: it borrows the server's pool from db.ts. What stays its
 * own is the time-series shape - a hypertable queried by time and speaker, so a
 * polling client (the Vision Pro Game Master) can ask for only what is new.
 *
 * A failure here still must never fail a transcript write or an HTTP request:
 * the session copy in `sessions.body` remains the fallback the reader uses.
 *
 * Never log the connection string, the host, or a raw driver error.
 */

export type SpeakerActivity = {
  speakerLabel: string;
  segments: number;
  words: number;
};

export function tigerEnabled() {
  return !!process.env.TIGER_DATABASE_URL;
}

function pool() {
  try {
    return tigerPool();
  } catch {
    report("connect");
    return undefined;
  }
}

function report(stage: string) {
  console.warn(`[tigerdb] ${stage} failed`);
}

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Fire and forget. Callers must not await this on a request path; a slow or
 * unreachable TigerDB must not delay the player's transcript.
 */
export function recordSegments(roomId: string, segments: TranscriptSegment[]) {
  if (!tigerEnabled() || !segments.length) return;
  void (async () => {
    const client = pool();
    if (!client) return;
    const columns = 9;
    const values: unknown[] = [];
    const rows = segments.map((segment, index) => {
      values.push(
        new Date(segment.at),
        roomId,
        segment.id,
        segment.sequence ?? null,
        segment.roundId ?? null,
        segment.speakerLabel ?? null,
        segment.origin ?? "microphone",
        words(segment.text),
        segment.text,
      );
      const base = index * columns;
      return `(${Array.from({ length: columns }, (_, i) => `$${base + i + 1}`).join(",")})`;
    });
    try {
      await client.query(
        `INSERT INTO transcript_segments
           (at, room_id, segment_id, sequence, round_id, speaker_label, origin, word_count, text)
         VALUES ${rows.join(",")}
         ON CONFLICT DO NOTHING`,
        values,
      );
    } catch {
      report("write");
    }
  })();
}

/** Newest-last, so a client can append the result to what it already shows. */
export async function readSegments(
  roomId: string,
  options: { since?: number; limit?: number } = {},
) {
  const client = pool();
  if (!client) return undefined;
  const limit = Math.min(Math.max(options.limit || 100, 1), 400);
  try {
    const result = await client.query(
      `SELECT at, segment_id, sequence, round_id, speaker_label, origin, text
         FROM transcript_segments
        WHERE room_id = $1 AND ($2::timestamptz IS NULL OR at > $2)
        ORDER BY at DESC, sequence DESC
        LIMIT $3`,
      [roomId, options.since ? new Date(options.since) : null, limit],
    );
    return result.rows.reverse().map((row): TranscriptSegment => ({
      id: row.segment_id,
      text: row.text,
      at: new Date(row.at).getTime(),
      ...(row.sequence === null ? {} : { sequence: Number(row.sequence) }),
      ...(row.round_id ? { roundId: row.round_id } : {}),
      ...(row.speaker_label ? { speakerLabel: row.speaker_label } : {}),
      origin: row.origin === "test" ? "test" : "microphone",
    }));
  } catch {
    report("read");
    return undefined;
  }
}

/** Reads the continuous aggregate. Powers the "who has been talking" meter. */
export async function speakerActivity(roomId: string, minutes = 20) {
  const client = pool();
  if (!client) return [];
  try {
    const result = await client.query(
      `SELECT speaker_label, sum(segments)::int AS segments, sum(words)::int AS words
         FROM speaker_activity_minute
        WHERE room_id = $1
          AND bucket > now() - ($2 || ' minutes')::interval
          AND speaker_label IS NOT NULL
        GROUP BY speaker_label
        ORDER BY words DESC`,
      [roomId, String(minutes)],
    );
    return result.rows.map((row): SpeakerActivity => ({
      speakerLabel: row.speaker_label,
      segments: row.segments,
      words: row.words,
    }));
  } catch {
    report("aggregate");
    return [];
  }
}

/**
 * The pool belongs to db.ts; closing the database closes this too. Kept as a
 * no-op so callers that shut the transcript store down explicitly still work.
 */
export async function closeTiger() {}
