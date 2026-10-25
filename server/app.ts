import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { openDb, getSession, save, event, type DB, type Session } from "./db";
import { encrypt, tokenHash } from "./security";
import { extract, recommend, validCandidate, fallback } from "./ai";
import {
  exchange,
  importProfile,
  instagramReady,
  redirectUri,
} from "./instagram";
import {
  createRoom,
  roomInfo,
  snapshot,
  controlSnapshot,
  capsuleSnapshot,
  activeQuestion,
  questionsSnapshot,
} from "./rooms";
import { questionsAccess } from "./questions-access";
import {
  configureConversationBudget,
  conversationState,
  ensureConversation,
  appendTranscript,
  segmentInput,
  enoughConversation,
  conversationInput,
  reserveSessionRequest,
} from "./conversation";
import { readSegments, speakerActivity, tigerEnabled } from "./tigerdb";
import { createAudioBridge } from "./audio";
import { createRewardEngine } from "./rewards";
import type { RoomEvent, Source } from "../shared/types";
const cookie = "centerpiece";
const text = z.string().trim().min(1).max(60);
export async function createApp(existing?: DB) {
  const db = existing ?? (await openDb());
  const demoMode = process.env.DEMO_MODE === "true";
  const minimumPlayers = demoMode ? 2 : 3;
  const demoCode = process.env.DEMO_ROOM_CODE?.trim().toUpperCase();
  async function demoRoom() {
    const s = demoCode ? await getSession(db, demoCode) : undefined;
    if (!s)
      throw Object.assign(new Error("The demo game is not configured yet."), {
        status: 503,
      });
    return s;
  }
  await db
    .prepare("DELETE FROM connections WHERE expires_at<?")
    .run(Date.now());
  await db.prepare("DELETE FROM oauth WHERE expires_at<?").run(Date.now());
  const app = express();
  await configureConversationBudget(db);
  const audio = createAudioBridge(db);
  const rewards = createRewardEngine(db);
  const generating = new Set<string>();
  const analyzingProfiles = new Set<string>();
  app.set("trust proxy", 1);
  app.get(["/relic", "/c"], (req, res) => {
    const query = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";
    res.redirect(302, `/prompt${query}`);
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  const secure = () =>
    new URL(process.env.PUBLIC_URL || "http://localhost:3000").protocol ===
    "https:";
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      const origin = req.get("origin");
      if (
        origin &&
        origin !== `${req.protocol}://${req.get("host")}` &&
        origin !== process.env.PUBLIC_URL
      )
        return res.status(403).json({ error: "Unrecognized request origin." });
    }
    next();
  });
  let eventSink: ((event: RoomEvent) => void) | undefined;
  const touch = async (s: Session, type: string) => {
    s.version++;
    await db.transaction(async (tx) => {
      await save(tx, s);
      await event(tx, s, type);
    });
    eventSink?.({
      schemaVersion: 1,
      type,
      roomId: s.id,
      roomVersion: s.version,
      at: Date.now(),
    });
  };
  const wrap =
    (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve()
        .then(() => fn(req, res))
        .catch(next);
  async function identity(req: Request) {
    const token = req.cookies[cookie];
    if (typeof token !== "string") return undefined;
    return await db
      .prepare("SELECT session_id,player_id FROM credentials WHERE token=?")
      .get<{ session_id: string; player_id: string }>(tokenHash(token));
  }
  async function auth(req: Request) {
    const who = await identity(req);
    const s = who && (await getSession(db, who.session_id));
    if (!who || !s || !s.players.some((p) => p.id === who.player_id))
      throw Object.assign(
        new Error("Scan Tina’s room QR to join before opening a prompt."),
        { status: 401 },
      );
    return { s, me: who.player_id };
  }
  function active(s: Session) {
    if (s.status === "finished")
      throw Object.assign(
        new Error("This gathering has ended. Join a new room from the bot."),
        { status: 409 },
      );
  }
  async function room(req: Request) {
    const s = await getSession(
      db,
      req.params.code ||
        (req as Request & { controlRoom?: string }).controlRoom ||
        "",
    );
    if (!s)
      throw Object.assign(
        new Error("This room could not be found. Scan the bot’s latest QR."),
        { status: 404 },
      );
    return s;
  }
  async function issue(res: Response, s: Session, playerId: string) {
    const token = randomBytes(32).toString("hex");
    await db
      .prepare("INSERT INTO credentials VALUES(?,?,?)")
      .run(tokenHash(token), s.id, playerId);
    res.cookie(cookie, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secure(),
      maxAge: 86400000,
    });
  }
  function notice(s: Session, me: string, value: string | undefined) {
    s.profileNotices ??= {};
    if (value) s.profileNotices[me] = value;
    else delete s.profileNotices[me];
  }
  async function imported(
    s: Session,
    me: string,
    sources: Source[],
    prefix = "",
  ) {
    const result = await extract(sources);
    const current = (await getSession(db, s.id))!;
    active(current);
    current.sources[me] = [
      ...(current.sources[me] || []).filter(
        (x) => x.kind === "manual" || x.kind === "intro",
      ),
      ...sources,
    ];
    const p = current.players.find((p) => p.id === me)!;
    p.interests = [
      ...p.interests.filter(
        (i) =>
          i.approved ||
          i.sourceIds.some((id) =>
            (current.sources[me] || []).some(
              (source) => source.id === id && source.kind === "intro",
            ),
          ),
      ),
      ...result.interests,
    ];
    current.recommendations = [];
    notice(
      current,
      me,
      [
        prefix,
        result.notice ||
          "Review your suggested interests, then add anything we missed.",
      ]
        .filter(Boolean)
        .join(" "),
    );
    return current;
  }
  app.get(
    "/api/demo",
    wrap(async (_req, res) => {
      res.json(
        demoMode
          ? { enabled: true, room: roomInfo(await demoRoom()) }
          : { enabled: false },
      );
    }),
  );
  app.get(
    "/api/rooms/:code",
    wrap(async (req, res) => {
      const s = await room(req);
      res.json({
        code: s.code,
        name: s.name,
        status: s.status,
        playerCount: s.players.length,
      });
    }),
  );
  app.get(
    "/api/session",
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      res.json(await snapshot(db, s, me));
    }),
  );
  app.post(
    "/api/join",
    wrap(async (req, res) => {
      const input = z
        .object({ code: text.optional(), name: text })
        .parse(req.body);
      const s = demoMode
        ? await demoRoom()
        : input.code && (await getSession(db, input.code));
      if (!s)
        return res
          .status(404)
          .json({ error: "Room not found. Scan the bot’s current QR." });
      active(s);
      const existing = await identity(req);
      if (existing?.session_id === s.id)
        return res.json(await snapshot(db, s, existing.player_id));
      if (s.players.length >= 6)
        return res
          .status(409)
          .json({ error: "This table already has six players." });
      const id = randomUUID();
      s.players.push({ id, name: input.name, interests: [], participation: 0 });
      await touch(s, "player.joined");
      await issue(res, s, id);
      res.json(await snapshot(db, s, id));
    }),
  );
  app.get(
    ["/api/capsule", "/api/relic", "/api/prompt"],
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      res.json(capsuleSnapshot(s, me));
    }),
  );
  app.post(
    "/api/interests",
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      active(s);
      const { labels, approvedIds } = z
        .object({
          labels: z.array(z.string().trim().min(2).max(50)).max(12),
          approvedIds: z.array(z.string()).max(24),
        })
        .parse(req.body);
      const p = s.players.find((p) => p.id === me)!;
      const existing = p.interests
        .filter((i) => approvedIds.includes(i.id))
        .map((i) => ({ ...i, approved: true }));
      const newLabels = labels.filter(
        (label, index) =>
          labels.findIndex(
            (item) => item.toLowerCase() === label.toLowerCase(),
          ) === index &&
          !existing.some((i) => i.label.toLowerCase() === label.toLowerCase()),
      );
      if (existing.length + newLabels.length > 12)
        return res
          .status(400)
          .json({ error: "Choose up to 12 interests in total." });
      for (const label of newLabels) {
        if (existing.some((i) => i.label.toLowerCase() === label.toLowerCase()))
          continue;
        const source: Source = {
          id: randomUUID(),
          text: label,
          kind: "manual",
        };
        (s.sources[me] ??= []).push(source);
        existing.push({
          id: randomUUID(),
          label,
          sourceIds: [source.id],
          approved: true,
        });
      }
      p.interests = existing;
      s.recommendations = [];
      notice(s, me, undefined);
      await touch(s, "profile.ready");
      res.json(await snapshot(db, s, me));
    }),
  );
  app.post(
    "/api/profile/text",
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      active(s);
      const input = z
        .object({ text: z.string().trim().min(1).max(16000) })
        .parse(req.body);
      const current = await imported(s, me, [
        { id: randomUUID(), kind: "bio", text: input.text },
      ]);
      await touch(current, "profile.imported");
      res.json(await snapshot(db, current, me));
    }),
  );
  app.post(
    "/api/profile/intro",
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      active(s);
      const { text: introText } = z
        .object({ text: z.string().trim().min(10).max(1200) })
        .parse(req.body);
      const revision = s.profileRevisions?.[me] || 0;
      const previous = s.sources[me] || [];
      const lastIntro = previous
        .filter((source) => source.kind === "intro")
        .at(-1);
      if (lastIntro?.text === introText)
        return res.json(await snapshot(db, s, me));
      if (analyzingProfiles.has(me))
        return res
          .status(409)
          .json({ error: "Your profile is already being analyzed." });
      const before = JSON.stringify({
        sources: previous,
        interests: s.players.find((p) => p.id === me)!.interests,
      });
      analyzingProfiles.add(me);
      try {
        const source: Source = {
          id: randomUUID(),
          kind: "intro",
          text: introText,
        };
        const result = await extract([source]);
        const current = (await getSession(db, s.id))!;
        active(current);
        const player = current.players.find((p) => p.id === me);
        if (
          !player ||
          (current.profileRevisions?.[me] || 0) !== revision ||
          JSON.stringify({
            sources: current.sources[me] || [],
            interests: player.interests,
          }) !== before
        )
          return res.status(409).json({
            error:
              "Your profile changed while we were finding interests. Review it before trying again.",
          });
        const oldIntroIds = new Set(
          previous
            .filter((source) => source.kind === "intro")
            .map((source) => source.id),
        );
        const kept = player.interests.filter(
          (i) => i.approved || !i.sourceIds.some((id) => oldIntroIds.has(id)),
        );
        const usedSources = new Set(kept.flatMap((i) => i.sourceIds));
        current.sources[me] = [
          ...previous.filter(
            (source) => source.kind !== "intro" || usedSources.has(source.id),
          ),
          source,
        ];
        const labels = new Set(kept.map((i) => i.label.toLowerCase()));
        player.interests = [
          ...kept,
          ...result.interests.filter((i) => {
            const label = i.label.toLowerCase();
            if (labels.has(label)) return false;
            labels.add(label);
            return true;
          }),
        ];
        current.recommendations = [];
        notice(
          current,
          me,
          result.notice ||
            (result.interests.length
              ? "Review the interests suggested from your introduction."
              : "Your introduction is saved. Add any interests you’d like to share."),
        );
        await touch(current, "profile.intro");
        res.json(await snapshot(db, current, me));
      } finally {
        analyzingProfiles.delete(me);
      }
    }),
  );
  app.post(
    "/api/profile/analyze",
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      active(s);
      const sources = (s.sources[me] || []).filter(
        (source) => source.kind !== "manual",
      );
      if (!sources.length)
        return res
          .status(409)
          .json({ error: "Import some profile text first." });
      if (analyzingProfiles.has(me))
        return res
          .status(409)
          .json({ error: "Your profile is already being analyzed." });
      analyzingProfiles.add(me);
      try {
        const result = await extract(sources);
        const current = (await getSession(db, s.id))!;
        active(current);
        const latestSources = (current.sources[me] || []).filter(
          (source) => source.kind !== "manual",
        );
        if (JSON.stringify(latestSources) !== JSON.stringify(sources))
          return res.status(409).json({
            error: "Your imported profile changed. Please try again.",
          });
        const player = current.players.find((p) => p.id === me);
        if (!player)
          return res.status(409).json({ error: "Your profile was removed." });
        const approved = player.interests.filter((i) => i.approved);
        const labels = new Set(approved.map((i) => i.label.toLowerCase()));
        player.interests = [
          ...approved,
          ...result.interests.filter((i) => !labels.has(i.label.toLowerCase())),
        ];
        current.recommendations = [];
        notice(
          current,
          me,
          result.notice ||
            `${result.interests.length} interests suggested from your saved profile. Review and approve what fits; existing approved interests are preserved.`,
        );
        await touch(current, "profile.analyzed");
        res.json(await snapshot(db, current, me));
      } finally {
        analyzingProfiles.delete(me);
      }
    }),
  );
  app.delete(
    "/api/profile",
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      await db.prepare("DELETE FROM connections WHERE player_id=?").run(me);
      await db.prepare("DELETE FROM oauth WHERE player_id=?").run(me);
      delete s.sources[me];
      s.profileRevisions ??= {};
      s.profileRevisions[me] = (s.profileRevisions[me] || 0) + 1;
      s.players.find((p) => p.id === me)!.interests = [];
      s.recommendations = [];
      notice(s, me, undefined);
      await touch(s, "profile.deleted");
      res.json(await snapshot(db, s, me));
    }),
  );
  app.get(
    "/api/instagram/connect",
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      active(s);
      if (!instagramReady()) return res.redirect("/?connection=setup");
      const state = randomBytes(32).toString("hex");
      await db
        .prepare("DELETE FROM oauth WHERE expires_at<? OR player_id=?")
        .run(Date.now(), me);
      await db
        .prepare("INSERT INTO oauth VALUES(?,?,?,?)")
        .run(state, me, s.id, Date.now() + 600000);
      const url = new URL("https://www.instagram.com/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: "instagram_business_basic",
        state,
      }).toString();
      res.redirect(url.toString());
    }),
  );
  app.get(
    "/api/instagram/callback",
    wrap(async (req, res) => {
      const { s, me } = await auth(req);
      active(s);
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const record = await db
        .prepare("SELECT * FROM oauth WHERE state=?")
        .get<{ player_id: string; session_id: string; expires_at: number }>(
          state,
        );
      if (
        !record ||
        record.player_id !== me ||
        record.session_id !== s.id ||
        record.expires_at < Date.now()
      )
        return res.redirect("/?connection=invalid");
      await db.prepare("DELETE FROM oauth WHERE state=?").run(state);
      if (req.query.error) return res.redirect("/?connection=denied");
      if (typeof req.query.code !== "string")
        return res.redirect("/?connection=invalid");
      try {
        const token = await exchange(req.query.code);
        const profile = await importProfile(token.token);
        const current = await imported(
          s,
          me,
          profile.sources,
          `Connected @${profile.username || "Instagram"}. Available: ${profile.available.join(", ") || "identity only"}. Unavailable: ${profile.unavailable.join(", ") || "none"}.`,
        );
        await db
          .prepare("INSERT OR REPLACE INTO connections VALUES(?,?,?,?)")
          .run(
            me,
            s.id,
            encrypt(token.token),
            Date.now() + token.expiresIn * 1000,
          );
        await touch(current, "profile.connected");
        return res.redirect("/?connection=success");
      } catch {
        return res.redirect("/?connection=failed");
      }
    }),
  );
  const questionsCookie = "destina_questions";
  async function allowQuestions(
    res: Response,
    sessionId: string,
    permission: "read" | "control" = "read",
  ) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    await db
      .prepare("DELETE FROM questions_access WHERE expires_at<?")
      .run(Date.now());
    await db
      .prepare(
        "INSERT INTO questions_access(token,session_id,expires_at,permission) VALUES(?,?,?,?)",
      )
      .run(tokenHash(token), sessionId, expiresAt, permission);
    res.cookie(questionsCookie, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: secure(),
      path: "/api/questions",
      maxAge: 12 * 60 * 60 * 1000,
    });
  }
  async function questionsRoom(req: Request, write = false) {
    if (demoMode) return await demoRoom();
    const token = req.cookies[questionsCookie];
    const record =
      typeof token === "string"
        ? await db
            .prepare(
              "SELECT session_id,permission FROM questions_access WHERE token=? AND expires_at>?",
            )
            .get<{ session_id: string; permission: string }>(
              tokenHash(token),
              Date.now(),
            )
        : undefined;
    const s = record && (await getSession(db, record.session_id));
    if (!s)
      throw Object.assign(new Error("Private Game Master access required."), {
        status: 401,
      });
    if (write && record.permission !== "control")
      throw Object.assign(
        new Error("Open a Game Master control link to change this room."),
        { status: 403 },
      );
    return s;
  }
  async function privateFeed(req: Request, s: Session) {
    const record = await db
      .prepare(
        "SELECT permission FROM questions_access WHERE token=? AND expires_at>?",
      )
      .get<{ permission: string }>(
        tokenHash(String(req.cookies[questionsCookie] || "")),
        Date.now(),
      );
    return await questionsSnapshot(
      s,
      generating.has(s.id),
      demoMode || record?.permission === "control",
      db,
    );
  }
  app.post(
    "/api/questions/access",
    wrap(async (req, res) => {
      const { token } = z
        .object({ token: z.string().length(64) })
        .parse(req.body);
      const record = await db
        .prepare(
          "DELETE FROM questions_invites WHERE token=? AND expires_at>? RETURNING session_id,permission",
        )
        .get<{ session_id: string; permission: "read" | "control" }>(
          tokenHash(token),
          Date.now(),
        );
      const s = record && (await getSession(db, record.session_id));
      if (!s)
        return res.status(401).json({
          error:
            "This access link expired or was already used. Request a new link.",
        });
      await allowQuestions(res, s.id, record!.permission);
      res.json(
        await questionsSnapshot(
          s,
          generating.has(s.id),
          record!.permission === "control",
          db,
        ),
      );
    }),
  );
  app.post(
    "/api/questions/login",
    wrap(async (req, res) => {
      const { key, code } = z
        .object({ key: z.string().min(1).max(512), code: z.string().length(6) })
        .parse(req.body);
      const expected = process.env.GM_API_KEY;
      if (
        !expected ||
        !timingSafeEqual(
          Buffer.from(tokenHash(key), "hex"),
          Buffer.from(tokenHash(expected), "hex"),
        )
      )
        return res.status(403).json({
          error:
            "The room code or access key could not be verified. You can also use a private access link.",
        });
      const s = await getSession(db, code.toUpperCase());
      if (!s)
        return res.status(403).json({
          error: "The room code or access key could not be verified.",
        });
      await allowQuestions(res, s.id, "control");
      res.json(await questionsSnapshot(s, generating.has(s.id), true, db));
    }),
  );
  app.get(
    "/api/questions/session",
    wrap(async (req, res) => {
      const s = await questionsRoom(req);
      if (
        !demoMode &&
        req.query.room &&
        String(req.query.room).toUpperCase() !== s.code
      )
        return res.status(403).json({
          error:
            "Your access is for another room. Open its private link or sign in again.",
        });
      res.json(await privateFeed(req, s));
    }),
  );
  app.delete(
    "/api/questions/session",
    wrap(async (req, res) => {
      const token = req.cookies[questionsCookie];
      if (typeof token === "string")
        await db
          .prepare("DELETE FROM questions_access WHERE token=?")
          .run(tokenHash(token));
      res.clearCookie(questionsCookie, {
        path: "/api/questions",
        httpOnly: true,
        sameSite: "strict",
        secure: secure(),
      });
      res.status(204).end();
    }),
  );
  app.use(
    [
      "/api/questions/recommendations",
      "/api/questions/assign",
      "/api/questions/clear",
      "/api/questions/finish",
      "/api/questions/reset",
      "/api/questions/rewards/approve",
      "/api/questions/rewards/settings",
      "/api/questions/rewards/settle",
      "/api/questions/conversation",
      "/api/questions/transcript",
      "/api/questions/speaker",
      "/api/questions/audio-ticket",
      "/api/questions/invite",
    ],
    (req, res, next) => {
      void questionsRoom(req, true)
        .then((s) => {
          req.params.code = s.code;
          (req as Request & { controlRoom?: string }).controlRoom = s.code;
          next();
        })
        .catch(next);
    },
  );
  app.post(
    "/api/questions/invite",
    wrap(async (req, res) => {
      const s = await questionsRoom(req, true);
      res.json(await questionsAccess(db, s, "control"));
    }),
  );
  // The Vision Pro transport will call these operations later. Player cookies grant no control access.
  app.use("/api/control", (req, res, next) => {
    const expected = process.env.GM_API_KEY;
    if (!expected)
      return res.status(503).json({
        error:
          "Configure GM_API_KEY on the server before connecting the Game Master.",
      });
    const actual = req.get("authorization")?.replace(/^Bearer /, "") || "";
    if (
      !timingSafeEqual(
        Buffer.from(tokenHash(actual), "hex"),
        Buffer.from(tokenHash(expected), "hex"),
      )
    )
      return res
        .status(403)
        .json({ error: "Game Master authorization required." });
    next();
  });
  app.post(
    "/api/control/rooms",
    wrap(async (req, res) => {
      const input = z.object({ name: text }).parse(req.body);
      const s = await createRoom(db, input.name);
      res.status(201).json({
        ...controlSnapshot(s),
        joinPath: `/join/${s.code}`,
        capsulePath: "/c",
        relicPath: "/relic",
        promptPath: "/prompt",
        questionsPath: `/questions?room=${s.code}`,
      });
    }),
  );
  app.post(
    "/api/control/rooms/:code/questions-access",
    wrap(async (req, res) => {
      const { permission } = z
        .object({ permission: z.enum(["read", "control"]).default("read") })
        .parse(req.body || {});
      res.json(await questionsAccess(db, await room(req), permission));
    }),
  );
  app.get(
    "/api/control/rooms/:code",
    wrap(async (req, res) => res.json(controlSnapshot(await room(req)))),
  );
  // The full Game Master feed over bearer auth. controlSnapshot is deliberately
  // thin; a headset Game Master needs the same view the browser at /gm has.
  app.get(
    "/api/control/rooms/:code/questions",
    wrap(async (req, res) => {
      const s = await room(req);
      res.json(await questionsSnapshot(s, generating.has(s.id), true, db));
    }),
  );

  app.post(
    [
      "/api/control/rooms/:code/recommendations",
      "/api/questions/recommendations",
    ],
    wrap(async (req, res) => {
      const s = await room(req);
      active(s);
      if (activeQuestion(s))
        return res.status(409).json({
          error: "Clear the current question before preparing the next one.",
        });
      if (
        s.players.length < minimumPlayers ||
        s.players.some((p) => !p.interests.some((i) => i.approved))
      )
        return res.status(409).json({
          error: `At least ${minimumPlayers} players are needed, and everyone must have an interest.`,
        });
      if (generating.has(s.id))
        return res
          .status(409)
          .json({ error: "Recommendations are already being prepared." });
      const input = z
        .object({
          context: z.string().max(800).default(""),
          targetPlayerId: z.string().optional(),
          origin: z
            .enum(["profiles", "conversation", "library"])
            .default("profiles"),
          replace: z.boolean().default(false),
        })
        .parse(req.body);
      if (
        input.targetPlayerId &&
        !s.players.some((p) => p.id === input.targetPlayerId)
      )
        return res
          .status(400)
          .json({ error: "The selected target is not in this room." });
      if (s.recommendations.length && !input.replace)
        return res.json(controlSnapshot(s));
      const c = ensureConversation(s);
      if (
        input.origin === "conversation" &&
        (c.generatedRound === s.rounds.length || !enoughConversation(s))
      ) {
        return res.status(409).json({
          error:
            c.generatedRound === s.rounds.length
              ? "Conversation prompts were already prepared for this turn. Use the saved set or play another turn."
              : "Add at least 40 new transcript words before preparing conversation prompts.",
        });
      }
      s.context = input.context;
      await touch(s, "recommendations.requested");
      const baseline = JSON.stringify({
        players: s.players,
        rounds: s.rounds,
        context: s.context,
      });
      const conversation =
        input.origin === "conversation" ? conversationInput(s) : undefined;
      const consumedSequence = c.sequence;
      generating.add(s.id);
      try {
        const result =
          input.origin === "library"
            ? {
                rewardSuggestions: [],
                recommendations: fallback(s, input.targetPlayerId),
                notice: "From the question library. No Muse request was made.",
                summary: undefined,
              }
            : await recommend(s, input.targetPlayerId, conversation, () =>
                reserveSessionRequest(db, s.id),
              );
        const current = (await getSession(db, s.id))!;
        if (
          current.status === "finished" ||
          JSON.stringify({
            players: current.players,
            rounds: current.rounds,
            context: current.context,
          }) !== baseline
        )
          return res.status(409).json({
            error: "The room changed. Request fresh recommendations.",
          });
        current.rewardSuggestions = [
          ...(current.rewardSuggestions || []),
          ...(result.rewardSuggestions || []),
        ].slice(-100);
        current.recommendations = result.recommendations;
        current.notice = result.notice;
        current.suggestionBatches ??= [];
        current.suggestionBatches.push({
          id: randomUUID(),
          createdAt: Date.now(),
          origin: input.origin === "conversation" ? "conversation" : "profiles",
          recommendations: structuredClone(result.recommendations),
        });
        if (conversation) {
          const state = ensureConversation(current);
          state.consumedSequence = consumedSequence;
          state.generatedRound = current.rounds.length;
          state.summary = result.summary || state.summary;
        }
        await touch(current, "recommendations.ready");
        res.json(controlSnapshot(current));
      } finally {
        generating.delete(s.id);
      }
    }),
  );
  app.post(
    ["/api/control/rooms/:code/assign", "/api/questions/assign"],
    wrap(async (req, res) => {
      const s = await room(req);
      active(s);
      const input = z
        .object({
          recommendationId: z.string(),
          instructions: z.string().trim().min(15).max(1200).optional(),
        })
        .parse(req.body);
      if (activeQuestion(s))
        return res.status(409).json({
          error: "Clear the current question before assigning another.",
        });
      if (
        s.players.length < minimumPlayers ||
        s.players.some((p) => !p.interests.some((i) => i.approved))
      )
        return res.status(409).json({
          error:
            "Every player needs at least one interest before the game can start.",
        });
      const rec = s.recommendations.find(
        (r) => r.id === input.recommendationId,
      );
      if (!rec || !validCandidate(s, rec))
        return res
          .status(409)
          .json({ error: "Recommendation expired. Request fresh options." });
      s.rounds.push({
        id: randomUUID(),
        number: s.rounds.length + 1,
        status: "assigned",
        assignedAt: Date.now(),
        recommendation: {
          ...rec,
          instructions: input.instructions || rec.instructions,
        },
      });
      s.status = "active";
      s.recommendations = [];
      await touch(s, "question.assigned");
      res.json(controlSnapshot(s));
    }),
  );
  app.post(
    ["/api/control/rooms/:code/clear", "/api/questions/clear"],
    wrap(async (req, res) => {
      const s = await room(req);
      active(s);
      const { status } = z
        .object({
          status: z.enum(["completed", "passed"]).default("completed"),
        })
        .parse(req.body);
      const question = activeQuestion(s);
      if (!question)
        return res
          .status(409)
          .json({ error: "No question is currently assigned." });
      question.status = status;
      question.endedAt = Date.now();
      for (const p of s.players)
        if (question.recommendation.participants.includes(p.id))
          p.participation++;
      await touch(s, "question.cleared");
      res.json(controlSnapshot(s));
      if (
        s.conversation?.automatic &&
        enoughConversation(s) &&
        s.players.length >= minimumPlayers &&
        s.players.every((p) => p.interests.some((i) => i.approved))
      ) {
        const invoke = async () => {
          if (generating.has(s.id)) return;
          generating.add(s.id);
          const input = conversationInput(s),
            consumed = conversationState(s).sequence;
          const baseline = JSON.stringify({
            players: s.players,
            rounds: s.rounds,
          });
          try {
            const result = await recommend(s, undefined, input, () =>
              reserveSessionRequest(db, s.id),
            );
            const current = (await getSession(db, s.id))!;
            if (
              current.status === "finished" ||
              activeQuestion(current) ||
              JSON.stringify({
                players: current.players,
                rounds: current.rounds,
              }) !== baseline
            )
              return;
            current.rewardSuggestions = [
              ...(current.rewardSuggestions || []),
              ...(result.rewardSuggestions || []),
            ].slice(-100);
            current.recommendations = result.recommendations;
            current.notice = result.notice;
            current.suggestionBatches ??= [];
            current.suggestionBatches.push({
              id: randomUUID(),
              createdAt: Date.now(),
              origin: "conversation",
              recommendations: structuredClone(result.recommendations),
            });
            const c = ensureConversation(current);
            c.summary = result.summary || c.summary;
            c.consumedSequence = consumed;
            c.generatedRound = current.rounds.length;
            await touch(current, "recommendations.ready");
          } finally {
            generating.delete(s.id);
          }
        };
        void invoke().catch(() => {});
      }
    }),
  );
  app.post(
    ["/api/control/rooms/:code/reset", "/api/questions/reset"],
    wrap(async (req, res) => {
      z.object({ confirm: z.literal(true) }).parse(req.body);
      const s = await room(req);
      if (
        generating.has(s.id) ||
        rewards.isSettling(s) ||
        s.players.some((p) => analyzingProfiles.has(p.id))
      )
        return res.status(409).json({
          error:
            "Wait for the current preparation to finish, then reset the game.",
        });
      audio.stop(s.id);
      const fresh: Session = {
        rewardGameId: randomUUID(),
        id: s.id,
        code: s.code,
        name: s.name,
        version: (await getSession(db, s.id))!.version,
        status: "lobby",
        players: [],
        recommendations: [],
        rounds: [],
        sources: {},
        context: "",
      };
      await db.transaction(async (tx) => {
        await rewards.archive(s, tx);
        for (const table of [
          "credentials",
          "connections",
          "oauth",
          "audio_tickets",
          "questions_invites",
          "events",
        ])
          await tx.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(s.id);
      });
      await touch(fresh, "game.reset");
      res.json({ ok: true });
    }),
  );
  app.post(
    [
      "/api/questions/rewards/approve",
      "/api/control/rooms/:code/rewards/approve",
    ],
    wrap(async (req, res) => {
      const s = await room(req);
      await rewards.approve(s, req.body);
      await touch(s, "rewards.approved");
      res.json({ ok: true });
    }),
  );
  app.post(
    [
      "/api/questions/rewards/settings",
      "/api/control/rooms/:code/rewards/settings",
    ],
    wrap(async (req, res) => {
      const s = await room(req);
      await rewards.configure(s, req.body);
      await touch(s, "rewards.settings");
      res.json({ ok: true });
    }),
  );
  app.post(
    [
      "/api/questions/rewards/settle",
      "/api/control/rooms/:code/rewards/settle",
    ],
    wrap(async (req, res) => {
      const s = await room(req);
      await rewards.settle(s, req.body, () => {
        void (async () => {
          const current = await getSession(db, s.id);
          if (current) await touch(current, "rewards.settled");
        })();
      });
      res.status(202).json({ ok: true });
    }),
  );
  app.post(
    ["/api/control/rooms/:code/finish", "/api/questions/finish"],
    wrap(async (req, res) => {
      const s = await room(req);
      active(s);
      audio.stop(s.id);
      s.conversation = undefined;
      s.status = "finished";
      s.sources = {};
      s.recommendations = [];
      s.profileNotices = {};
      const question = activeQuestion(s);
      if (question) question.status = "passed";
      for (const p of s.players) for (const i of p.interests) i.sourceIds = [];
      await db.prepare("DELETE FROM oauth WHERE session_id=?").run(s.id);
      await touch(s, "room.closed");
      res.json(controlSnapshot(s));
    }),
  );
  app.post(
    ["/api/questions/conversation", "/api/control/rooms/:code/conversation"],
    wrap(async (req, res) => {
      const s = await room(req);
      active(s);
      const input = z
        .object({
          automatic: z.boolean().optional(),
          action: z.enum(["pause", "clear"]).optional(),
        })
        .parse(req.body);
      const c = ensureConversation(s);
      if (input.automatic !== undefined) c.automatic = input.automatic;
      if (input.action) {
        audio.stop(s.id);
        c.status = "paused";
      }
      if (input.action === "clear") {
        c.segments = [];
        c.summary = "";
        c.consumedSequence = c.sequence;
        c.speakerLinks = {};
        c.dismissedSpeakerHints = [];
      }
      await touch(s, "conversation.updated");
      res.json({ ok: true });
    }),
  );
  app.post(
    ["/api/questions/transcript", "/api/control/rooms/:code/transcript"],
    wrap(async (req, res) => {
      const s = await room(req);
      active(s);
      const input = segmentInput.parse(req.body);
      const changed = appendTranscript(s, input, "test");
      if (changed) await touch(s, "transcript.appended");
      res.json({ ok: true, duplicate: !changed });
    }),
  );
  // Incremental transcript reads for a polling client. Served from TigerDB
  // when it is configured, and from the in-session copy otherwise, so the
  // headset behaves the same either way.
  app.get(
    ["/api/questions/transcript", "/api/control/rooms/:code/transcript"],
    wrap(async (req, res) => {
      const s = await room(req);
      const since = Number(req.query.since);
      const sinceAt =
        Number.isSafeInteger(since) && since > 0 ? since : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 400);
      const c = conversationState(s);
      const stored = tigerEnabled()
        ? await readSegments(s.id, { since: sinceAt, limit })
        : undefined;
      const segments = (
        stored ||
        c.segments
          .filter((segment) => !sinceAt || segment.at > sinceAt)
          .slice(-limit)
      ).map((segment) => ({
        ...segment,
        speakerId:
          c.speakerLinks[segment.speakerLabel || ""] || segment.speakerId,
      }));
      res.json({
        source: stored ? "tigerdb" : "session",
        segments,
        speakers: stored ? await speakerActivity(s.id) : [],
      });
    }),
  );
  app.post(
    ["/api/questions/speaker", "/api/control/rooms/:code/speaker"],
    wrap(async (req, res) => {
      const s = await room(req);
      active(s);
      if (generating.has(s.id))
        return res.status(409).json({
          error:
            "Wait for prompt preparation to finish before changing speaker assignments.",
        });
      const { speakerLabel, playerId, dismissRoundId } = z
        .object({
          speakerLabel: z.string().min(1).max(100),
          playerId: z.string().nullable(),
          dismissRoundId: z.string().optional(),
        })
        .parse(req.body);
      const c = ensureConversation(s);
      if (!c.segments.some((segment) => segment.speakerLabel === speakerLabel))
        return res.status(400).json({ error: "Unknown speaker label." });
      if (playerId && !s.players.some((player) => player.id === playerId))
        return res
          .status(400)
          .json({ error: "That player is not in this room." });
      if (dismissRoundId) {
        if (
          !c.segments.some(
            (segment) =>
              segment.speakerLabel === speakerLabel &&
              segment.roundId === dismissRoundId,
          )
        )
          return res
            .status(400)
            .json({ error: "That prompt has no matching speaker evidence." });
        c.dismissedSpeakerHints = [
          ...(c.dismissedSpeakerHints || []),
          `${speakerLabel}:${dismissRoundId}`,
        ].slice(-100);
      }
      if (playerId) c.speakerLinks[speakerLabel] = playerId;
      else delete c.speakerLinks[speakerLabel];
      await touch(s, "speaker.mapped");
      res.json({ ok: true });
    }),
  );
  app.post(
    ["/api/questions/audio-ticket", "/api/control/rooms/:code/audio-ticket"],
    wrap(async (req, res) => {
      const s = await room(req);
      active(s);
      const { consent, format } = z
        .object({
          consent: z.literal(true),
          format: z.enum(["container", "linear16"]).default("container"),
        })
        .parse(req.body);
      if (!process.env.DEEPGRAM_API_KEY)
        return res.status(503).json({
          error:
            "Add DEEPGRAM_API_KEY on the server to enable hosted transcription. Transcript testing is available without it.",
        });
      res.json(audio.ticket(s.id, format));
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { status?: number; message?: string };
    res.status(err instanceof z.ZodError ? 400 : e.status || 500).json({
      error:
        err instanceof z.ZodError
          ? "Please check the supplied fields."
          : e.status
            ? e.message
            : "Something went wrong. Please try again.",
    });
  });
  return {
    rewards,
    app,
    db,
    audio,
    identity,
    setEventSink: (fn: (event: RoomEvent) => void) => {
      eventSink = fn;
    },
  };
}
