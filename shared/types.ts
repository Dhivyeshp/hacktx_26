export type CapsuleType =
  "Duel" | "Bounty" | "Hot Seat" | "Jinx" | "Forge" | "Golden";
export type InterestSuggestion = {
  id: string;
  label: string;
  sourceIds: string[];
  approved: boolean;
};
export type Source = {
  id: string;
  text: string;
  kind: "bio" | "caption" | "manual" | "sample";
};
export type Player = {
  id: string;
  name: string;
  interests: InterestSuggestion[];
  participation: number;
  sample?: boolean;
};
export type Recommendation = {
  id: string;
  type: CapsuleType;
  title: string;
  instructions: string;
  secret?: string;
  participants: string[];
  duration: number;
  reason: string;
  sourceInterestIds: string[];
  mode: "live" | "fallback";
  score: number;
};
export type Round = {
  id: string;
  number: number;
  recommendation: Recommendation;
  status: "assigned" | "completed" | "passed";
};
export type RoomInfo = {
  id: string;
  code: string;
  name: string;
  version: number;
  status: "lobby" | "active" | "finished";
  playerCount: number;
  readyCount: number;
};
/** Player-only data. No recommendation queue or other players' private profiles. */
export type Snapshot = {
  room: RoomInfo;
  me: Player;
  sources: Source[];
  connected: boolean;
  instagramReady: boolean;
  notice?: string;
};
export type CapsulePrompt = {
  id: string;
  number: number;
  type: CapsuleType;
  title: string;
  instructions: string;
  secret?: string;
  participants: { id: string; name: string }[];
  duration: number;
  isTarget: boolean;
};
export type CapsuleSnapshot = { room: RoomInfo; prompt: CapsulePrompt | null };
/** For the trusted Vision Pro / bot adapter, never sent to player browsers. */
export type ControlSnapshot = {
  room: RoomInfo;
  players: Player[];
  recommendations: Recommendation[];
  activeQuestion: Round | null;
  aiReady: boolean;
  notice?: string;
};
/** Transport-neutral event envelope for the later WebSocket adapter. */
export type RoomEvent = {
  schemaVersion: 1;
  type: string;
  roomId: string;
  roomVersion: number;
  at: number;
};
