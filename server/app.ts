import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { openDb, getSession, save, event, type Session } from "./db";
import { encrypt, tokenHash } from "./security";
import { extract, recommend, validCandidate } from "./ai";
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
import type { RoomEvent, Source } from "../shared/types";
const cookie = "centerpiece";
const text = z.string().trim().min(1).max(60);
export function createApp(db = openDb()) {
  db.prepare("DELETE FROM connections WHERE expires_at<?").run(Date.now());
  db.prepare("DELETE FROM oauth WHERE expires_at<?").run(Date.now());
  const app = express();
  const generating = new Set<string>();
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
  const touch = (s: Session, type: string) => {
    s.version++;
    db.transaction(() => {
      save(db, s);
      event(db, s, type);
    })();
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
  function identity(req: Request) {
    const token = req.cookies[cookie];
    if (typeof token !== "string") return undefined;
    return db
      .prepare("SELECT session_id,player_id FROM credentials WHERE token=?")
      .get(tokenHash(token)) as
      { session_id: string; player_id: string } | undefined;
  }
  function auth(req: Request) {
    const who = identity(req);
    const s = who && getSession(db, who.session_id);
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
  function room(req: Request) {
    const s = getSession(db, req.params.code);
    if (!s)
      throw Object.assign(
        new Error("This room could not be found. Scan the bot’s latest QR."),
        { status: 404 },
      );
    return s;
  }
  function issue(res: Response, s: Session, playerId: string) {
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO credentials VALUES(?,?,?)").run(
      tokenHash(token),
      s.id,
      playerId,
    );
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
    const current = getSession(db, s.id)!;
    active(current);
    current.sources[me] = [
      ...(current.sources[me] || []).filter((x) => x.kind === "manual"),
      ...sources,
    ];
    const p = current.players.find((p) => p.id === me)!;
    p.interests = [
      ...p.interests.filter((i) => i.approved),
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
    "/api/rooms/:code",
    wrap((req, res) => {
      const s = room(req);
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
    wrap((req, res) => {
      const { s, me } = auth(req);
      res.json(snapshot(db, s, me));
    }),
  );
  app.post(
    "/api/join",
    wrap((req, res) => {
      const input = z.object({ code: text, name: text }).parse(req.body);
      const s = getSession(db, input.code);
      if (!s)
        return res
          .status(404)
          .json({ error: "Room not found. Scan the bot’s current QR." });
      active(s);
      const existing = identity(req);
      if (existing?.session_id === s.id)
        return res.json(snapshot(db, s, existing.player_id));
      if (s.players.length >= 6)
        return res
          .status(409)
          .json({ error: "This table already has six players." });
      const id = randomUUID();
      s.players.push({ id, name: input.name, interests: [], participation: 0 });
      touch(s, "player.joined");
      issue(res, s, id);
      res.json(snapshot(db, s, id));
    }),
  );
  app.get(
    ["/api/capsule", "/api/relic", "/api/prompt"],
    wrap((req, res) => {
      const { s, me } = auth(req);
      res.json(capsuleSnapshot(s, me));
    }),
  );
  app.post(
    "/api/interests",
    wrap((req, res) => {
      const { s, me } = auth(req);
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
      touch(s, "profile.ready");
      res.json(snapshot(db, s, me));
    }),
  );
  app.post(
    "/api/profile/text",
    wrap(async (req, res) => {
      const { s, me } = auth(req);
      active(s);
      const input = z
        .object({ text: z.string().trim().min(1).max(16000) })
        .parse(req.body);
      const current = await imported(s, me, [
        { id: randomUUID(), kind: "bio", text: input.text },
      ]);
      touch(current, "profile.imported");
      res.json(snapshot(db, current, me));
    }),
  );
  const analyzingProfiles = new Set<string>();
  app.post(
    "/api/profile/analyze",
    wrap(async (req, res) => {
      const { s, me } = auth(req);
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
        const current = getSession(db, s.id)!;
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
        touch(current, "profile.analyzed");
        res.json(snapshot(db, current, me));
      } finally {
        analyzingProfiles.delete(me);
      }
    }),
  );
  app.delete(
    "/api/profile",
    wrap((req, res) => {
      const { s, me } = auth(req);
      db.prepare("DELETE FROM connections WHERE player_id=?").run(me);
      db.prepare("DELETE FROM oauth WHERE player_id=?").run(me);
      delete s.sources[me];
      s.players.find((p) => p.id === me)!.interests = [];
      s.recommendations = [];
      notice(s, me, undefined);
      touch(s, "profile.deleted");
      res.json(snapshot(db, s, me));
    }),
  );
  app.get(
    "/api/instagram/connect",
    wrap((req, res) => {
      const { s, me } = auth(req);
      active(s);
      if (!instagramReady()) return res.redirect("/?connection=setup");
      const state = randomBytes(32).toString("hex");
      db.prepare("DELETE FROM oauth WHERE expires_at<? OR player_id=?").run(
        Date.now(),
        me,
      );
      db.prepare("INSERT INTO oauth VALUES(?,?,?,?)").run(
        state,
        me,
        s.id,
        Date.now() + 600000,
      );
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
      const { s, me } = auth(req);
      active(s);
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const record = db
        .prepare("SELECT * FROM oauth WHERE state=?")
        .get(state) as
        | { player_id: string; session_id: string; expires_at: number }
        | undefined;
      if (
        !record ||
        record.player_id !== me ||
        record.session_id !== s.id ||
        record.expires_at < Date.now()
      )
        return res.redirect("/?connection=invalid");
      db.prepare("DELETE FROM oauth WHERE state=?").run(state);
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
        db.prepare("INSERT OR REPLACE INTO connections VALUES(?,?,?,?)").run(
          me,
          s.id,
          encrypt(token.token),
          Date.now() + token.expiresIn * 1000,
        );
        touch(current, "profile.connected");
        return res.redirect("/?connection=success");
      } catch {
        return res.redirect("/?connection=failed");
      }
    }),
  );
  const questionsCookie = "destina_questions";
  function allowQuestions(res: Response, sessionId: string) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    db.prepare("DELETE FROM questions_access WHERE expires_at<?").run(
      Date.now(),
    );
    db.prepare("INSERT INTO questions_access VALUES(?,?,?)").run(
      tokenHash(token),
      sessionId,
      expiresAt,
    );
    res.cookie(questionsCookie, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: secure(),
      path: "/api/questions",
      maxAge: 12 * 60 * 60 * 1000,
    });
  }
  function questionsRoom(req: Request) {
    const token = req.cookies[questionsCookie];
    const record =
      typeof token === "string"
        ? (db
            .prepare(
              "SELECT session_id FROM questions_access WHERE token=? AND expires_at>?",
            )
            .get(tokenHash(token), Date.now()) as
            { session_id: string } | undefined)
        : undefined;
    const s = record && getSession(db, record.session_id);
    if (!s)
      throw Object.assign(new Error("Private Game Master access required."), {
        status: 401,
      });
    return s;
  }
  app.post(
    "/api/questions/access",
    wrap((req, res) => {
      const { token } = z
        .object({ token: z.string().length(64) })
        .parse(req.body);
      const record = db
        .prepare(
          "DELETE FROM questions_invites WHERE token=? AND expires_at>? RETURNING session_id",
        )
        .get(tokenHash(token), Date.now()) as
        { session_id: string } | undefined;
      const s = record && getSession(db, record.session_id);
      if (!s)
        return res
          .status(401)
          .json({
            error:
              "This access link expired or was already used. Request a new link.",
          });
      allowQuestions(res, s.id);
      res.json(questionsSnapshot(s, generating.has(s.id)));
    }),
  );
  app.post(
    "/api/questions/login",
    wrap((req, res) => {
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
        return res
          .status(403)
          .json({
            error:
              "The room code or access key could not be verified. You can also use a private access link.",
          });
      const s = getSession(db, code.toUpperCase());
      if (!s)
        return res
          .status(403)
          .json({
            error: "The room code or access key could not be verified.",
          });
      allowQuestions(res, s.id);
      res.json(questionsSnapshot(s, generating.has(s.id)));
    }),
  );
  app.get(
    "/api/questions/session",
    wrap((req, res) => {
      const s = questionsRoom(req);
      if (req.query.room && String(req.query.room).toUpperCase() !== s.code)
        return res
          .status(403)
          .json({
            error:
              "Your access is for another room. Open its private link or sign in again.",
          });
      res.json(questionsSnapshot(s, generating.has(s.id)));
    }),
  );
  app.delete(
    "/api/questions/session",
    wrap((req, res) => {
      const token = req.cookies[questionsCookie];
      if (typeof token === "string")
        db.prepare("DELETE FROM questions_access WHERE token=?").run(
          tokenHash(token),
        );
      res.clearCookie(questionsCookie, {
        path: "/api/questions",
        httpOnly: true,
        sameSite: "strict",
        secure: secure(),
      });
      res.status(204).end();
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
    wrap((req, res) => {
      const input = z.object({ name: text }).parse(req.body);
      const s = createRoom(db, input.name);
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
    wrap((req, res) => {
      res.json(questionsAccess(db, room(req)));
    }),
  );
  app.get(
    "/api/control/rooms/:code",
    wrap((req, res) => res.json(controlSnapshot(room(req)))),
  );

  app.post(
    "/api/control/rooms/:code/recommendations",
    wrap(async (req, res) => {
      const s = room(req);
      active(s);
      if (activeQuestion(s))
        return res.status(409).json({
          error: "Clear the current question before preparing the next one.",
        });
      if (
        s.players.length < 3 ||
        s.players.some((p) => !p.interests.some((i) => i.approved))
      )
        return res.status(409).json({
          error: "At least three players with approved interests are needed.",
        });
      if (generating.has(s.id))
        return res
          .status(409)
          .json({ error: "Recommendations are already being prepared." });
      const input = z
        .object({
          context: z.string().max(800).default(""),
          targetPlayerId: z.string().optional(),
        })
        .parse(req.body);
      if (
        input.targetPlayerId &&
        !s.players.some((p) => p.id === input.targetPlayerId)
      )
        return res
          .status(400)
          .json({ error: "The selected target is not in this room." });
      s.context = input.context;
      touch(s, "recommendations.requested");
      const version = s.version;
      generating.add(s.id);
      try {
        const result = await recommend(s, input.targetPlayerId);
        const current = getSession(db, s.id)!;
        if (current.version !== version)
          return res.status(409).json({
            error: "The room changed. Request fresh recommendations.",
          });
        Object.assign(current, result);
        current.suggestionBatches ??= [];
        current.suggestionBatches.push({
          id: randomUUID(),
          createdAt: Date.now(),
          origin: "profiles",
          recommendations: structuredClone(result.recommendations),
        });
        touch(current, "recommendations.ready");
        res.json(controlSnapshot(current));
      } finally {
        generating.delete(s.id);
      }
    }),
  );
  app.post(
    "/api/control/rooms/:code/assign",
    wrap((req, res) => {
      const s = room(req);
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
        recommendation: {
          ...rec,
          instructions: input.instructions || rec.instructions,
        },
      });
      s.status = "active";
      s.recommendations = [];
      touch(s, "question.assigned");
      res.json(controlSnapshot(s));
    }),
  );
  app.post(
    "/api/control/rooms/:code/clear",
    wrap((req, res) => {
      const s = room(req);
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
      for (const p of s.players)
        if (question.recommendation.participants.includes(p.id))
          p.participation++;
      touch(s, "question.cleared");
      res.json(controlSnapshot(s));
    }),
  );
  app.post(
    "/api/control/rooms/:code/finish",
    wrap((req, res) => {
      const s = room(req);
      active(s);
      s.status = "finished";
      s.sources = {};
      s.recommendations = [];
      s.profileNotices = {};
      const question = activeQuestion(s);
      if (question) question.status = "passed";
      for (const p of s.players) for (const i of p.interests) i.sourceIds = [];
      db.prepare("DELETE FROM oauth WHERE session_id=?").run(s.id);
      touch(s, "room.closed");
      res.json(controlSnapshot(s));
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
    app,
    db,
    identity,
    setEventSink: (fn: (event: RoomEvent) => void) => {
      eventSink = fn;
    },
  };
}
