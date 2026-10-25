import { createHash, randomUUID } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  rewardCriteria,
  type RewardAward,
  type RewardsSnapshot,
  type PlayerRewards,
} from "../shared/rewards";
import { getSession, type DB, type Session } from "./db";
import { encrypt } from "./security";

export const rewardGameId = (s: Session) => s.rewardGameId || s.id;
const configured = () =>
  !!process.env.CHAIN_SERVICE_URL && !!process.env.CHAIN_API_TOKEN;
const fail = (message: string, status = 409): never => {
  throw Object.assign(new Error(message), { status });
};
const reviewSchema = z.object({
  roundId: z.string(),
  awards: z
    .array(
      z.object({
        playerId: z.string(),
        criteria: z
          .array(
            z.enum([
              "contribution",
              "followup",
              "building",
              "inclusion",
              "creation",
            ]),
          )
          .max(5)
          .refine((v) => new Set(v).size === v.length),
        evidenceIds: z.array(z.string()).max(6).default([]),
        note: z.string().trim().max(240).default(""),
      }),
    )
    .max(6),
});
type Job = {
  game_id: string;
  round_id: string;
  round_no: number;
  state: string;
  payload: string;
  results: string;
  error?: string;
};
type Receipt = { playerId: string; points: number; signature?: string };
function settings(db: DB, s: Session) {
  return (
    (db
      .prepare("SELECT * FROM reward_settings WHERE game_id=?")
      .get(rewardGameId(s)) as
      { goal: number; paused: number; celebrated: number } | undefined) || {
      goal: 40,
      paused: 0,
      celebrated: 0,
    }
  );
}
export function rewardsSnapshot(db: DB, s: Session): RewardsSnapshot {
  const gameId = rewardGameId(s),
    config = settings(db, s);
  const reviews = db
    .prepare("SELECT round_id,awards FROM reward_reviews WHERE game_id=?")
    .all(gameId) as { round_id: string; awards: string }[];
  const jobs = db
    .prepare("SELECT * FROM reward_jobs WHERE game_id=?")
    .all(gameId) as Job[];
  const rounds = s.rounds
    .filter((r) => r.status !== "assigned")
    .map((r) => {
      const review = reviews.find((x) => x.round_id === r.id),
        job = jobs.find((x) => x.round_id === r.id);
      const receipts: Receipt[] = job ? JSON.parse(job.results) : [];
      const awards: RewardAward[] = (
        review ? JSON.parse(review.awards) : []
      ).map((a: RewardAward) => {
        const receipt = receipts.find((x) => x.playerId === a.playerId);
        return {
          ...a,
          confirmed: !!receipt,
          ...(receipt?.signature ? { signature: receipt.signature } : {}),
        };
      });
      return {
        roundId: r.id,
        number: r.number,
        title: r.recommendation.title,
        status: r.status as "completed" | "passed",
        awards,
        settlement: (job?.state || (review ? "approved" : "unreviewed")) as
          "approved" | "unreviewed" | "processing" | "confirmed" | "failed",
        ...(job?.error ? { error: job.error } : {}),
      };
    });
  const players = s.players.map((p) => {
    const awards = rounds.flatMap((r) =>
      r.awards.filter((a) => a.playerId === p.id),
    );
    const approved = awards.reduce((n, a) => n + a.points, 0),
      confirmed = awards
        .filter((a) => a.confirmed)
        .reduce((n, a) => n + a.points, 0);
    const completed = s.rounds.filter(
      (r) =>
        r.status === "completed" &&
        r.recommendation.participants.includes(p.id),
    );
    const connections = new Set(
      completed.flatMap((r) =>
        r.recommendation.participants.filter((id) => id !== p.id),
      ),
    ).size;
    const wallet = db
      .prepare("SELECT wallet FROM reward_wallets WHERE player_id=?")
      .get(p.id) as { wallet: string } | undefined;
    return {
      playerId: p.id,
      approved,
      confirmed,
      pending: approved - confirmed,
      level: 1 + Math.floor(Math.sqrt(confirmed / 10)),
      completed: completed.length,
      passed: s.rounds.filter(
        (r) =>
          r.status === "passed" && r.recommendation.participants.includes(p.id),
      ).length,
      connections,
      confirmedSpeechSegments: (s.conversation?.segments || []).filter(
        (seg) =>
          seg.origin === "microphone" &&
          (s.conversation?.speakerLinks[seg.speakerLabel || ""] ||
            seg.speakerId) === p.id,
      ).length,
      breakdown: Object.fromEntries(
        rewardCriteria.map((c) => [
          c.id,
          awards.filter((a) => a.criteria.includes(c.id)).length,
        ]),
      ) as Record<(typeof rewardCriteria)[number]["id"], number>,
      ...(wallet ? { wallet: wallet.wallet } : {}),
    };
  });
  return {
    currency: "Tina Tokens",
    network: "devnet",
    configured: configured(),
    gameId,
    goal: config.goal,
    paused: !!config.paused,
    celebrated: !!config.celebrated,
    approved: players.reduce((n, p) => n + p.approved, 0),
    confirmed: players.reduce((n, p) => n + p.confirmed, 0),
    players,
    rounds,
    suggestions: s.rewardSuggestions || [],
  };
}
export function playerRewards(db: DB, s: Session, id: string): PlayerRewards {
  const all = rewardsSnapshot(db, s),
    p = all.players.find((p) => p.playerId === id)!;
  return {
    currency: all.currency,
    network: all.network,
    configured: all.configured,
    approved: p.approved,
    confirmed: p.confirmed,
    pending: p.pending,
    level: p.level,
    wallet: p.wallet,
    goal: all.goal,
    tableApproved: all.approved,
    tableConfirmed: all.confirmed,
    goalReached: all.approved >= all.goal,
  };
}

export function createRewardEngine(db: DB, fetcher: typeof fetch = fetch) {
  const busy = new Set<string>();
  function audit(s: Session, kind: string, body: unknown, roundId?: string) {
    db.prepare("INSERT INTO reward_audit VALUES(?,?,?,?,?,?)").run(
      randomUUID(),
      rewardGameId(s),
      roundId || null,
      kind,
      JSON.stringify(body),
      Date.now(),
    );
  }
  async function chain(path: string, body?: unknown): Promise<any> {
    if (!configured())
      fail("Configure the devnet chain service before settlement.", 503);
    const url = new URL(process.env.CHAIN_SERVICE_URL!);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname))
    )
      fail("Use an HTTPS chain service URL.", 503);
    const response = await fetcher(
      url.origin + url.pathname.replace(/\/$/, "") + path,
      {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(path === "/rounds/settle" ? 60000 : 20000),
        headers: {
          "Content-Type": "application/json",
          ...(body
            ? { Authorization: `Bearer ${process.env.CHAIN_API_TOKEN}` }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (!body && response.status === 404 && path.startsWith("/sessions/"))
      return null;
    if (!response.ok)
      fail(
        `The devnet service returned HTTP ${response.status}. Check its credential, funding and configuration, then retry.`,
        502,
      );
    return response.json();
  }
  function approve(s: Session, input: unknown) {
    const config = settings(db, s);
    if (config.paused) fail("Awards are paused. Resume them first.");
    const data = reviewSchema.parse(input),
      round = s.rounds.find((r) => r.id === data.roundId);
    if (!round || round.status === "assigned")
      fail("Complete or pass the round before reviewing awards.");
    if (
      db
        .prepare("SELECT 1 FROM reward_jobs WHERE game_id=? AND round_id=?")
        .get(rewardGameId(s), data.roundId)
    )
      fail("This settlement is locked. Retry it without changing the awards.");
    if (
      data.awards.length !== s.players.length ||
      new Set(data.awards.map((a) => a.playerId)).size !== s.players.length ||
      data.awards.some((a) => !s.players.some((p) => p.id === a.playerId))
    )
      fail("Review each current player exactly once.", 400);
    const awards = data.awards.map((a) => {
      if (round!.status === "passed" && a.criteria.length)
        fail("Passed rounds carry no awards or penalties.", 400);
      if (
        a.criteria.some((c) => c !== "contribution") &&
        !a.note &&
        !a.evidenceIds.length
      )
        fail(
          "Add a short GM observation or confirmed transcript evidence for bonuses.",
          400,
        );
      for (const id of a.evidenceIds) {
        const segment = s.conversation?.segments.find((seg) => seg.id === id);
        const playerId =
          segment &&
          (s.conversation?.speakerLinks[segment.speakerLabel || ""] ||
            segment.speakerId);
        if (
          !segment ||
          segment.origin !== "microphone" ||
          segment.roundId !== round!.id ||
          playerId !== a.playerId
        )
          fail(
            "Evidence must be real speech from this round with a confirmed player name.",
            400,
          );
      }
      return {
        ...a,
        points: rewardCriteria
          .filter((c) => a.criteria.includes(c.id))
          .reduce((n, c) => n + c.points, 0),
      };
    });
    db.transaction(() => {
      db.prepare(
        "INSERT INTO reward_reviews VALUES(?,?,?,?) ON CONFLICT(game_id,round_id) DO UPDATE SET awards=excluded.awards,updated_at=excluded.updated_at",
      ).run(rewardGameId(s), data.roundId, JSON.stringify(awards), Date.now());
      audit(s, "awards.approved", awards, data.roundId);
    })();
  }
  function configure(s: Session, input: unknown) {
    const data = z
      .object({
        goal: z.number().int().min(10).max(1000).optional(),
        paused: z.boolean().optional(),
        celebrated: z.boolean().optional(),
      })
      .parse(input);
    const before = settings(db, s),
      gameId = rewardGameId(s);
    if (
      data.goal !== undefined &&
      data.goal !== before.goal &&
      db.prepare("SELECT 1 FROM reward_jobs WHERE game_id=?").get(gameId)
    )
      fail("The table goal is fixed once settlement has started.");
    if (
      data.celebrated &&
      rewardsSnapshot(db, s).approved < (data.goal || before.goal)
    )
      fail("Reach the shared goal before celebrating.");
    db.prepare("INSERT OR REPLACE INTO reward_settings VALUES(?,?,?,?)").run(
      gameId,
      data.goal ?? before.goal,
      data.paused === undefined ? before.paused : Number(data.paused),
      data.celebrated === undefined
        ? before.celebrated
        : Number(data.celebrated),
    );
    audit(s, "settings.updated", data);
  }
  async function wallet(playerId: string) {
    let row = db
      .prepare("SELECT * FROM reward_wallets WHERE player_id=?")
      .get(playerId) as { wallet: string; registered: number } | undefined;
    if (!row) {
      const key = Keypair.generate();
      // Persist before registration: a timeout must not create an inaccessible second wallet.
      db.prepare("INSERT INTO reward_wallets VALUES(?,?,?,0)").run(
        playerId,
        key.publicKey.toBase58(),
        encrypt(Buffer.from(key.secretKey).toString("base64")),
      );
      row = { wallet: key.publicKey.toBase58(), registered: 0 };
    }
    if (!row.registered) {
      const registered = await chain("/players", { wallet: row.wallet });
      if (registered.wallet !== row.wallet)
        fail("The devnet wallet response did not match.", 502);
      new PublicKey(registered.wallet);
      db.prepare(
        "UPDATE reward_wallets SET registered=1 WHERE player_id=?",
      ).run(playerId);
    }
    return row.wallet;
  }
  async function runSettlement(
    s: Session,
    roundId: string,
    changed: () => void,
  ) {
    const gameId = rewardGameId(s);
    let job = db
      .prepare("SELECT * FROM reward_jobs WHERE game_id=? AND round_id=?")
      .get(gameId, roundId) as Job | undefined;
    try {
      const status = await chain("/status");
      if (
        status.cluster !== "devnet" ||
        status.initialized !== true ||
        status.ok !== true
      )
        fail(
          "Settlement is restricted to an initialized Solana devnet service.",
        );
      const review = db
        .prepare(
          "SELECT awards FROM reward_reviews WHERE game_id=? AND round_id=?",
        )
        .get(gameId, roundId) as { awards: string };
      const awards: RewardAward[] = JSON.parse(review.awards);
      if (!job || !JSON.parse(job.payload).awards) {
        const round = s.rounds.find((r) => r.id === roundId)!;
        const payload = {
          sessionId: gameId,
          roundNo: round.number,
          eventsHash: createHash("sha256")
            .update(JSON.stringify({ gameId, roundId, awards }))
            .digest("hex"),
          awards: [] as {
            wallet: string;
            points: number;
            connections: number;
            playerId: string;
          }[],
        };
        for (const a of awards.filter((a) => a.points > 0))
          payload.awards.push({
            wallet: await wallet(a.playerId),
            playerId: a.playerId,
            points: a.points,
            connections: 0,
          });
        db.prepare(
          "UPDATE reward_jobs SET payload=? WHERE game_id=? AND round_id=?",
        ).run(JSON.stringify(payload), gameId, roundId);
        job = db
          .prepare("SELECT * FROM reward_jobs WHERE game_id=? AND round_id=?")
          .get(gameId, roundId) as Job;
      }
      const payload = JSON.parse(job.payload);
      const session = await chain(`/sessions/${encodeURIComponent(gameId)}`);
      if (!session)
        await chain("/sessions", {
          sessionId: gameId,
          goal: settings(db, s).goal,
          bonusPerPlayer: 0,
        });
      const result = await chain("/rounds/settle", {
        ...payload,
        awards: payload.awards.map(({ playerId, ...a }: any) => a),
      });
      const receipts: Receipt[] = JSON.parse(job.results);
      for (const a of payload.awards) {
        const match =
          Array.isArray(result.awards) &&
          result.awards.find(
            (x: any) => x.wallet === a.wallet && x.points === a.points,
          );
        if (
          match &&
          !match.error &&
          ((typeof match.signature === "string" &&
            /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(match.signature)) ||
            match.skipped === "already paid")
        ) {
          if (!receipts.some((r) => r.playerId === a.playerId))
            receipts.push({
              playerId: a.playerId,
              points: a.points,
              ...(match.signature ? { signature: match.signature } : {}),
            });
        }
      }
      const complete = payload.awards.every((a: any) =>
        receipts.some((r) => r.playerId === a.playerId),
      );
      db.prepare(
        "UPDATE reward_jobs SET state=?,results=?,error=? WHERE game_id=? AND round_id=?",
      ).run(
        complete ? "confirmed" : "failed",
        JSON.stringify(receipts),
        complete
          ? null
          : "Some awards are still pending. Retry to reconcile them without paying twice.",
        gameId,
        roundId,
      );
      audit(
        s,
        complete ? "settlement.confirmed" : "settlement.partial",
        receipts,
        roundId,
      );
    } catch (error) {
      // Keep provider internals and credentials out of public demo errors.
      if (job)
        db.prepare(
          "UPDATE reward_jobs SET state='failed',error=? WHERE game_id=? AND round_id=?",
        ).run(
          (error as { status?: number; message?: string }).status
            ? (error as Error).message
            : "Settlement is pending. Check the devnet network, wallet encryption and service funding, then retry.",
          gameId,
          roundId,
        );
      else
        db.prepare(
          "INSERT OR REPLACE INTO reward_audit VALUES(?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          gameId,
          roundId,
          "settlement.failed",
          "{}",
          Date.now(),
        );
    } finally {
      busy.delete(gameId);
      changed();
    }
  }
  function settle(s: Session, input: unknown, changed: () => void) {
    const { roundId } = z.object({ roundId: z.string() }).parse(input),
      gameId = rewardGameId(s);
    if (!configured())
      fail(
        "Configure CHAIN_SERVICE_URL and CHAIN_API_TOKEN on the server first.",
        503,
      );
    if (settings(db, s).paused) fail("Awards are paused. Resume them first.");
    if (busy.has(gameId)) fail("A settlement is already in progress.");
    const row = db
      .prepare(
        "SELECT awards FROM reward_reviews WHERE game_id=? AND round_id=?",
      )
      .get(gameId, roundId) as { awards: string } | undefined;
    if (!row) fail("Approve the round's awards before settling.");
    if (!(JSON.parse(row!.awards) as RewardAward[]).some((a) => a.points > 0))
      fail("This round has no Tina Tokens to settle.");
    const job = db
      .prepare("SELECT * FROM reward_jobs WHERE game_id=? AND round_id=?")
      .get(gameId, roundId) as Job | undefined;
    if (job?.state === "confirmed") return;
    if (!job) {
      const round = s.rounds.find((r) => r.id === roundId);
      if (!round || round.status === "assigned")
        fail("This round is not ready for settlement.");
      db.prepare(
        "INSERT INTO reward_jobs(game_id,round_id,round_no,state,payload) VALUES(?,?,?,'processing','{}')",
      ).run(gameId, roundId, round!.number);
    }
    busy.add(gameId);
    if (job)
      db.prepare(
        "UPDATE reward_jobs SET state='processing',error=NULL WHERE game_id=? AND round_id=?",
      ).run(gameId, roundId);
    audit(s, "settlement.requested", {}, roundId);
    void runSettlement(s, roundId, changed);
  }
  return {
    approve,
    configure,
    settle,
    archive: (s: Session) => {
      const gameId = rewardGameId(s);
      const rows = db
        .prepare("SELECT round_id,awards FROM reward_reviews WHERE game_id=?")
        .all(gameId) as { round_id: string; awards: string }[];
      for (const row of rows)
        db.prepare(
          "UPDATE reward_reviews SET awards=? WHERE game_id=? AND round_id=?",
        ).run(
          JSON.stringify(
            JSON.parse(row.awards).map((a: RewardAward) => ({
              ...a,
              note: "",
              evidenceIds: [],
            })),
          ),
          gameId,
          row.round_id,
        );
      db.prepare("DELETE FROM reward_audit WHERE game_id=?").run(gameId);
    },
    isSettling: (s: Session) => busy.has(rewardGameId(s)),
    recover: () =>
      db
        .prepare(
          "UPDATE reward_jobs SET state='failed',error='The server restarted. Retry to reconcile pending awards.' WHERE state='processing'",
        )
        .run(),
  };
}
