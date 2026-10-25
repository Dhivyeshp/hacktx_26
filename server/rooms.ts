import { randomBytes, randomUUID } from "node:crypto";
import type {
  RoomInfo,
  ControlSnapshot,
  CapsuleSnapshot,
  Snapshot,
  QuestionsSnapshot,
} from "../shared/types";
import { save, event, type DB, type Session } from "./db";
import { instagramReady } from "./instagram";
export function createRoom(db: DB, name: string): Session {
  const room: Session = {
    id: randomUUID(),
    code: randomBytes(3).toString("hex").toUpperCase(),
    name,
    version: 1,
    status: "lobby",
    players: [],
    recommendations: [],
    rounds: [],
    sources: {},
    context: "",
  };
  save(db, room);
  event(db, room, "room.created");
  return room;
}
export function roomInfo(s: Session): RoomInfo {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    version: s.version,
    status: s.status,
    playerCount: s.players.length,
    readyCount: s.players.filter((p) => p.interests.some((i) => i.approved))
      .length,
  };
}
export const activeQuestion = (s: Session) =>
  [...s.rounds].reverse().find((r) => r.status === "assigned") || null;
export function snapshot(db: DB, s: Session, meId: string): Snapshot {
  return {
    room: roomInfo(s),
    me: s.players.find((p) => p.id === meId)!,
    sources: s.sources[meId] || [],
    connected: !!db
      .prepare(
        "SELECT player_id FROM connections WHERE player_id=? AND expires_at>?",
      )
      .get(meId, Date.now()),
    instagramReady: instagramReady(),
    notice: s.profileNotices?.[meId],
  };
}
export function capsuleSnapshot(s: Session, meId: string): CapsuleSnapshot {
  const current = s.status === "finished" ? null : activeQuestion(s);
  if (!current) return { room: roomInfo(s), prompt: null };
  const rec = current.recommendation;
  return {
    room: roomInfo(s),
    prompt: {
      id: current.id,
      number: current.number,
      type: rec.type,
      title: rec.title,
      instructions: rec.instructions,
      ...(rec.participants[0] === meId && rec.secret
        ? { secret: rec.secret }
        : {}),
      participants: rec.participants.map((id) => ({
        id,
        name: s.players.find((p) => p.id === id)?.name || "Player",
      })),
      duration: rec.duration,
      isTarget: rec.participants[0] === meId,
    },
  };
}
export function controlSnapshot(s: Session): ControlSnapshot {
  return {
    room: roomInfo(s),
    players: s.players.map((p) => ({
      ...p,
      interests: p.interests.filter((i) => i.approved),
    })),
    recommendations: s.recommendations,
    activeQuestion: activeQuestion(s),
    aiReady: !!process.env.MODEL_API_KEY,
    notice: s.notice,
  };
}

export function questionsSnapshot(
  s: Session,
  preparing = false,
): QuestionsSnapshot {
  const batches = s.suggestionBatches?.length
    ? s.suggestionBatches
    : s.recommendations.length
      ? [
          {
            id: "current-options",
            createdAt: null,
            origin: "profiles" as const,
            recommendations: s.recommendations,
          },
        ]
      : [];
  return {
    schemaVersion: 1,
    room: roomInfo(s),
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.interests.some((i) => i.approved),
      participation: p.participation,
    })),
    batches,
    activeQuestion: s.status === "finished" ? null : activeQuestion(s),
    history: s.rounds,
    preparing,
    notice: s.notice,
    conversation: { status: "not_connected", segments: [] },
  };
}
