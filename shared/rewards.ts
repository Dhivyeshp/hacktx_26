export const rewardCriteria = [
  { id: "contribution", label: "Contributed to the prompt", points: 2 },
  { id: "followup", label: "Asked a thoughtful follow-up", points: 3 },
  { id: "building", label: "Built on someone’s idea", points: 2 },
  {
    id: "inclusion",
    label: "Invited someone into the conversation",
    points: 2,
  },
  { id: "creation", label: "Finished something together", points: 1 },
] as const;
export type RewardCriterion = (typeof rewardCriteria)[number]["id"];
export type RewardSuggestion = {
  roundId: string;
  playerId: string;
  criterion: RewardCriterion;
  evidenceIds: string[];
  reason: string;
};
export type RewardAward = {
  playerId: string;
  criteria: RewardCriterion[];
  evidenceIds: string[];
  note: string;
  points: number;
  confirmed: boolean;
  signature?: string;
};
export type RewardRound = {
  roundId: string;
  number: number;
  title: string;
  status: "completed" | "passed";
  awards: RewardAward[];
  settlement: "unreviewed" | "approved" | "processing" | "failed" | "confirmed";
  error?: string;
};
export type RewardPlayerStats = {
  playerId: string;
  approved: number;
  confirmed: number;
  pending: number;
  level: number;
  completed: number;
  passed: number;
  connections: number;
  confirmedSpeechSegments: number;
  breakdown: Record<RewardCriterion, number>;
  wallet?: string;
};
export type RewardsSnapshot = {
  currency: "Tina Tokens";
  network: "devnet";
  configured: boolean;
  gameId: string;
  goal: number;
  paused: boolean;
  celebrated: boolean;
  approved: number;
  confirmed: number;
  players: RewardPlayerStats[];
  rounds: RewardRound[];
  suggestions: RewardSuggestion[];
};
export type PlayerRewards = {
  currency: "Tina Tokens";
  network: "devnet";
  configured: boolean;
  approved: number;
  confirmed: number;
  pending: number;
  level: number;
  wallet?: string;
  goal: number;
  tableApproved: number;
  tableConfirmed: number;
  goalReached: boolean;
};
