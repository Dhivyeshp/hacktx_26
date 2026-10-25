import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Session, DB } from "./db";
import type { ConversationState, TranscriptSegment } from "../shared/types";
import { save } from "./db";

export function conversationState(s: Session): ConversationState {
  return (
    s.conversation || {
      status: "not_connected",
      segments: [],
      summary: "",
      consumedSequence: 0,
      sequence: 0,
      speakerLinks: {},
      automatic: false,
    }
  );
}
export function ensureConversation(s: Session) {
  return (s.conversation ??= conversationState(s));
}
export const segmentInput = z.object({
  id: z.string().min(1).max(150),
  text: z.string().trim().min(1).max(1600),
  speakerLabel: z.string().min(1).max(100).optional(),
});
export function appendTranscript(
  s: Session,
  input: z.infer<typeof segmentInput>,
  origin: "microphone" | "test",
  at = Date.now(),
) {
  const c = ensureConversation(s);
  if (c.segments.some((segment) => segment.id === input.id)) return false;
  c.sequence++;
  const round = s.rounds
    .slice()
    .reverse()
    .find((round) =>
      round.assignedAt
        ? at >= round.assignedAt && (!round.endedAt || at <= round.endedAt)
        : round.status === "assigned",
    );
  c.segments.push({
    ...input,
    at,
    sequence: c.sequence,
    origin,
    ...(round ? { roundId: round.id } : {}),
  });
  // Bounded in-session text. Old transcript is not retained indefinitely.
  c.segments = c.segments.slice(-400);
  return true;
}
export function pendingConversation(s: Session) {
  const c = conversationState(s);
  return c.segments
    .filter((segment) => (segment.sequence || 0) > c.consumedSequence)
    .slice(-60);
}
export function enoughConversation(s: Session) {
  return (
    pendingConversation(s)
      .map((segment) => segment.text)
      .join(" ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length >= 40
  );
}
export function conversationInput(s: Session) {
  const c = conversationState(s);
  const pending = pendingConversation(s);
  let remaining = 7000;
  const selected: TranscriptSegment[] = [];
  for (const segment of pending.slice().reverse()) {
    if (segment.text.length > remaining) break;
    selected.unshift(segment);
    remaining -= segment.text.length;
  }
  return {
    summary: c.summary,
    segments: selected.map((segment) => ({
      id: segment.id,
      text: segment.text,
      speakerLabel: segment.speakerLabel,
      playerId: c.speakerLinks[segment.speakerLabel || ""],
      origin: segment.origin,
      roundId: segment.roundId,
    })),
  };
}
function ledger(db: DB) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS game_model_attempts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,at INTEGER NOT NULL)",
  );
}
// A separate ledger prevents transcript updates from resetting the actual-request allowance.
export function configureConversationBudget(db: DB) {
  ledger(db);
}
export function sessionRequestUsage(sessionId: string, db?: DB) {
  const value = Number(process.env.GAME_MODEL_MAX_REQUESTS || 12);
  const requestLimit = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const requestCount = db
    ? (
        db
          .prepare(
            "SELECT count(*) AS n FROM game_model_attempts WHERE session_id=?",
          )
          .get(sessionId) as { n: number }
      ).n
    : 0;
  return { requestCount, requestLimit };
}
export function reserveSessionRequest(db: DB, sessionId: string) {
  ledger(db);
  db.transaction(() => {
    const { requestLimit } = sessionRequestUsage(sessionId, db);
    const { n } = db
      .prepare(
        "SELECT count(*) AS n FROM game_model_attempts WHERE session_id=?",
      )
      .get(sessionId) as { n: number };
    if (n >= requestLimit)
      throw new Error("This game's Muse allowance is exhausted");
    db.prepare("INSERT INTO game_model_attempts VALUES(?,?,?)").run(
      randomUUID(),
      sessionId,
      Date.now(),
    );
  }).immediate();
}
export function resetLiveRecordings(db: DB) {
  for (const row of db.prepare("SELECT body FROM sessions").all() as {
    body: string;
  }[]) {
    const s = JSON.parse(row.body) as Session;
    if (s.conversation?.status === "live") {
      s.conversation.status = "paused";
      s.conversation.notice =
        "Listening stopped when the server restarted. Start again when ready.";
      save(db, s);
    }
  }
}

/** Prompt assignment supplies a candidate, never a speaker identity. The GM confirms it. */
export function speakerHints(s: Session) {
  const c = conversationState(s);
  const seen = new Set<string>();
  const hints: {
    speakerLabel: string;
    roundId: string;
    playerId: string;
    name: string;
    excerpt: string;
  }[] = [];
  for (const segment of c.segments.slice().reverse()) {
    const label = segment.speakerLabel;
    if (!label || seen.has(label) || c.speakerLinks[label]) continue;
    seen.add(label);
    const round = s.rounds.find((round) => round.id === segment.roundId);
    if (
      !round ||
      round.recommendation.participants.length !== 1 ||
      c.dismissedSpeakerHints?.includes(`${label}:${round.id}`)
    )
      continue;
    const player = s.players.find(
      (player) => player.id === round.recommendation.participants[0],
    );
    if (player)
      hints.push({
        speakerLabel: label,
        roundId: round.id,
        playerId: player.id,
        name: player.name,
        excerpt: segment.text.slice(0, 220),
      });
  }
  return hints.slice(0, 6);
}
