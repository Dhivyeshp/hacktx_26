import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, save } from "../server/db";
import { createRoom } from "../server/rooms";
import {
  createRewardEngine,
  playerRewards,
  rewardsSnapshot,
} from "../server/rewards";
import { rewardCriteria } from "../shared/rewards";
import { fallback } from "../server/ai";
import { decrypt } from "../server/security";

process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
process.env.CHAIN_SERVICE_URL = "https://devnet-service.example";
process.env.CHAIN_API_TOKEN = "test-chain-credential";
function fixture() {
  const db = openDb(":memory:"),
    s = createRoom(db, "Rewards rehearsal");
  s.players = ["Maya", "Rowan"].map((name, i) => ({
    id: `player-${i}`,
    name,
    participation: 0,
    interests: [
      {
        id: `interest-${i}`,
        label: i ? "Hiking" : "Pottery",
        sourceIds: [],
        approved: true,
      },
    ],
  }));
  s.rounds = [
    {
      id: "round-1",
      number: 1,
      status: "completed",
      assignedAt: 1000,
      endedAt: 2000,
      recommendation: fallback(s)[0],
    },
  ];
  save(db, s);
  const awards = [
    {
      playerId: "player-0",
      criteria: ["contribution"],
      note: "",
      evidenceIds: [],
    },
    { playerId: "player-1", criteria: [], note: "", evidenceIds: [] },
  ];
  return { db, s, awards };
}
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
async function settle(
  engine: ReturnType<typeof createRewardEngine>,
  s: ReturnType<typeof fixture>["s"],
) {
  await new Promise<void>((resolve, reject) => {
    try {
      engine.settle(s, { roundId: "round-1" }, resolve);
    } catch (e) {
      reject(e);
    }
  });
}
test("award scoring is capped, explicit, editable before settlement and private to each player", () => {
  const { db, s, awards } = fixture();
  const engine = createRewardEngine(db);
  assert.throws(
    () =>
      engine.approve(s, {
        roundId: "round-1",
        awards: [{ ...awards[0], criteria: ["followup"] }, awards[1]],
      }),
    /observation/,
  );
  assert.throws(() =>
    engine.approve(s, {
      roundId: "round-1",
      awards: [
        { ...awards[0], criteria: ["contribution", "contribution"] },
        awards[1],
      ],
    }),
  );
  assert.throws(
    () =>
      engine.approve(s, {
        roundId: "round-1",
        awards: [{ ...awards[0], playerId: "outsider" }, awards[1]],
      }),
    /each current player/,
  );
  engine.approve(s, {
    roundId: "round-1",
    awards: [
      {
        ...awards[0],
        criteria: rewardCriteria.map((c) => c.id),
        note: "GM observed each action",
      },
      awards[1],
    ],
  });
  assert.equal(rewardsSnapshot(db, s).approved, 10);
  assert.equal(rewardsSnapshot(db, s).confirmed, 0);
  assert.equal(playerRewards(db, s, "player-0").pending, 10);
  assert.ok(
    !JSON.stringify(playerRewards(db, s, "player-0")).includes("GM observed"),
  );
  engine.approve(s, { roundId: "round-1", awards });
  assert.equal(rewardsSnapshot(db, s).approved, 2);
  s.rounds[0].status = "assigned";
  assert.throws(
    () => engine.approve(s, { roundId: "round-1", awards }),
    /Complete or pass/,
  );
  s.rounds[0].status = "passed";
  assert.throws(
    () => engine.approve(s, { roundId: "round-1", awards }),
    /Passed rounds/,
  );
  engine.approve(s, {
    roundId: "round-1",
    awards: awards.map((a) => ({ ...a, criteria: [] })),
  });
  assert.equal(rewardsSnapshot(db, s).approved, 0);
  db.close();
});
test("speech evidence requires a real microphone segment in the right round with confirmed identity", () => {
  const { db, s, awards } = fixture();
  const engine = createRewardEngine(db);
  s.conversation = {
    status: "paused",
    segments: [
      {
        id: "speech",
        text: "What happened next?",
        at: 1500,
        roundId: "round-1",
        speakerLabel: "voice",
        origin: "microphone",
      },
    ],
    summary: "",
    consumedSequence: 0,
    sequence: 1,
    speakerLinks: {},
    automatic: false,
  };
  const review = {
    roundId: "round-1",
    awards: [
      { ...awards[0], criteria: ["followup"], evidenceIds: ["speech"] },
      awards[1],
    ],
  };
  assert.throws(() => engine.approve(s, review), /confirmed player/);
  s.conversation.speakerLinks.voice = "player-0";
  engine.approve(s, review);
  assert.equal(rewardsSnapshot(db, s).approved, 3);
  s.conversation.segments[0].origin = "test";
  assert.throws(() => engine.approve(s, review), /real speech/);
  s.conversation.segments[0].origin = "microphone";
  s.conversation.segments[0].roundId = "another-round";
  assert.throws(() => engine.approve(s, review), /this round/);
  db.close();
});
test("devnet settlement preserves encrypted wallets and frozen amounts through partial failures and retries", async () => {
  const { db, s, awards } = fixture();
  let attempt = 0;
  const sent: any[] = [];
  let registrations = 0;
  const engine = createRewardEngine(db, (async (url: any, options: any) => {
    const path = new URL(String(url)).pathname,
      body = options?.body ? JSON.parse(options.body) : null;
    assert.ok(!String(url).includes("test-chain-credential"));
    if (body)
      assert.equal(
        options.headers.Authorization,
        "Bearer test-chain-credential",
      );
    if (path === "/status")
      return json({ ok: true, cluster: "devnet", initialized: true });
    if (path === "/players") {
      registrations++;
      assert.equal(body.secretKey, undefined);
      return json({ wallet: body.wallet });
    }
    if (path.startsWith("/sessions/"))
      return new Response("{}", { status: 404 });
    if (path === "/sessions") return json({ session: "test-session" });
    if (path === "/rounds/settle") {
      sent.push(body);
      attempt++;
      return json({
        awards: body.awards.map((a: any, i: number) => {
          if (i === 0)
            return { ...a, signature: null, skipped: "already paid" };
          return attempt === 1
            ? { ...a, error: "Temporary RPC failure" }
            : { ...a, signature: "2".repeat(88) };
        }),
      });
    }
    throw new Error("Unexpected path");
  }) as typeof fetch);
  engine.approve(s, {
    roundId: "round-1",
    awards: awards.map((a) => ({ ...a, criteria: ["contribution"] })),
  });
  await settle(engine, s);
  const partial = rewardsSnapshot(db, s);
  assert.equal(partial.rounds[0].settlement, "failed");
  assert.equal(partial.confirmed, 2);
  assert.equal(partial.approved, 4);
  assert.throws(
    () => engine.approve(s, { roundId: "round-1", awards }),
    /locked/,
  );
  assert.throws(() => engine.configure(s, { goal: 50 }), /fixed/);
  const wallet = db
    .prepare("SELECT * FROM reward_wallets WHERE player_id='player-0'")
    .get() as any;
  assert.equal(
    Buffer.from(decrypt(wallet.encrypted_secret), "base64").length,
    64,
  );
  assert.ok(!JSON.stringify(partial).includes(wallet.encrypted_secret));
  await settle(engine, s);
  const complete = rewardsSnapshot(db, s);
  assert.equal(complete.confirmed, 4);
  assert.equal(complete.rounds[0].settlement, "confirmed");
  assert.equal(registrations, 2);
  assert.deepEqual(sent[0], sent[1]);
  engine.settle(s, { roundId: "round-1" }, () => {});
  assert.equal(sent.length, 2);
  assert.equal(sent[0].awards[0].playerId, undefined);
  assert.ok(!JSON.stringify(sent[0]).includes("GM observed"));
  engine.archive(s);
  assert.equal(
    (
      JSON.parse(
        (db.prepare("SELECT awards FROM reward_reviews").get() as any).awards,
      ) as any[]
    ).every((a) => a.note === "" && a.evidenceIds.length === 0),
    true,
  );
  assert.equal(
    (db.prepare("SELECT count(*) n FROM reward_audit").get() as any).n,
    0,
  );
  s.rewardGameId = "fresh-game";
  assert.equal(rewardsSnapshot(db, s).confirmed, 0);
  assert.equal(
    (db.prepare("SELECT count(*) n FROM reward_jobs").get() as any).n,
    1,
  );
  db.close();
});
test("mainnet is blocked before any wallet or award write, and restart recovery leaves work retryable", async () => {
  const { db, s, awards } = fixture();
  const calls: string[] = [];
  const engine = createRewardEngine(db, (async (url: any) => {
    calls.push(new URL(String(url)).pathname);
    return json({ ok: true, initialized: true, cluster: "mainnet-beta" });
  }) as typeof fetch);
  engine.approve(s, { roundId: "round-1", awards });
  await settle(engine, s);
  assert.deepEqual(calls, ["/status"]);
  assert.equal(rewardsSnapshot(db, s).confirmed, 0);
  assert.equal(rewardsSnapshot(db, s).rounds[0].settlement, "failed");
  assert.equal(
    (db.prepare("SELECT count(*) n FROM reward_wallets").get() as any).n,
    0,
  );
  db.prepare("UPDATE reward_jobs SET state='processing'").run();
  engine.recover();
  assert.equal(rewardsSnapshot(db, s).rounds[0].settlement, "failed");
  db.close();
});
test("wallet registration retries reuse the persisted wallet, and pause blocks new approvals and settlements", async () => {
  const { db, s, awards } = fixture();
  const wallets: string[] = [];
  const engine = createRewardEngine(db, (async (url: any, opts: any) => {
    const path = new URL(String(url)).pathname;
    if (path === "/status")
      return json({ ok: true, initialized: true, cluster: "devnet" });
    if (path === "/players") {
      wallets.push(JSON.parse(opts.body).wallet);
      throw new Error("Provider timeout");
    }
    throw new Error("Unexpected request");
  }) as typeof fetch);
  engine.configure(s, { paused: true });
  assert.throws(
    () => engine.approve(s, { roundId: "round-1", awards }),
    /paused/,
  );
  assert.throws(
    () => engine.settle(s, { roundId: "round-1" }, () => {}),
    /paused/,
  );
  engine.configure(s, { paused: false, goal: 20 });
  engine.approve(s, { roundId: "round-1", awards });
  await settle(engine, s);
  await settle(engine, s);
  assert.equal(wallets.length, 2);
  assert.equal(wallets[0], wallets[1]);
  assert.equal(rewardsSnapshot(db, s).confirmed, 0);
  assert.throws(
    () => engine.configure(s, { celebrated: true }),
    /Reach the shared goal/,
  );
  db.close();
});
