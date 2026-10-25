import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileText,
  Instagram,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Shield,
  Sun,
  Moon,
  X,
} from "lucide-react";
import type {
  Snapshot,
  CapsuleSnapshot,
  InterestSuggestion,
} from "../shared/types";
import "./style.css";
import { Questions } from "./questions";
import { VoiceIntro } from "./voice-intro";
import { interestLabel, importSummary } from "./profile-copy";
import { interestSelectionChanged } from "./profile-state";
async function api(path: string, body?: unknown, method?: string) {
  const response = await fetch("/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Something went wrong. Try again."),
      { status: response.status },
    );
  return data;
}
type RoomPreview = {
  name: string;
  code: string;
  status: string;
  playerCount: number;
};
function App() {
  const query = new URLSearchParams(location.search);
  const requestedRoom = (
    location.pathname.match(/^\/join\/([a-z0-9]+)\/?$/i)?.[1] ||
    query.get("room") ||
    query.get("join") ||
    ""
  ).toUpperCase();
  const fromChip = ["/c", "/relic", "/prompt"].includes(
    location.pathname.replace(/\/$/, ""),
  );
  const [demo, setDemo] = useState(false);
  const [s, setS] = useState<Snapshot | null>(null),
    [loaded, setLoaded] = useState(false),
    [view, setView] = useState<"profile" | "capsule">(
      fromChip ? "capsule" : "profile",
    ),
    [room, setRoom] = useState<RoomPreview | null>(null),
    [code, setCode] = useState(requestedRoom),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const sRef = useRef(s);
  sRef.current = s;
  const accept = (next: Snapshot) =>
    setS((current) =>
      !current ||
      current.room.id !== next.room.id ||
      next.room.version >= current.room.version
        ? next
        : current,
    );
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const config = await api("/demo");
        if (stopped) return;
        setDemo(config.enabled);
        const targetCode = config.enabled ? config.room.code : requestedRoom;
        if (config.enabled) setCode(config.room.code);
        const [session, target] = await Promise.all([
          api("/session").catch(() => null),
          targetCode
            ? api("/rooms/" + encodeURIComponent(targetCode))
            : Promise.resolve(null),
        ]);
        if (stopped) return;
        if (target) setRoom(target);
        if (session && (!targetCode || session.room.code === targetCode)) {
          accept(session);
          if (!fromChip) setView("profile");
        } else if (session) setName(session.me.name);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {
        if (!stopped) setLoaded(true);
      }
    })();
    const connection = query.get("connection");
    const messages: Record<string, string> = {
      setup:
        "Instagram connection is not available yet. You can add your interests below.",
      denied:
        "You declined Instagram access. Try again, or add your interests below.",
      invalid: "That connection request expired. Please try connecting again.",
      failed:
        "We couldn’t connect your account. Try again, or add your interests below.",
    };
    if (connection && messages[connection]) setError(messages[connection]);
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (!s) return;
    const refresh = async () => {
      try {
        const current: Snapshot = await api("/session");
        if (sRef.current?.room.id === current.room.id) accept(current);
      } catch (e: any) {
        if (e.status === 401) location.reload();
      }
    };
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [s?.room.id]);
  const run = async (
    key: string,
    path: string,
    body?: unknown,
    method?: string,
  ) => {
    setBusy(key);
    setError("");
    try {
      const next = await api(path, body, method);
      if (next.me) accept(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };
  const joined = !!s;
  const ended = s?.room.status === "finished";
  if (!loaded)
    return (
      <div className="loading-screen">
        <p>Finding your table…</p>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="header">
        <a className="brand" href="/" aria-label="destina home">
          <img
            className="brand-mark theme-dark"
            src="/logo-mark-dark.svg"
            alt=""
            aria-hidden="true"
            width="52"
            height="52"
          />
          <img
            className="brand-mark theme-light"
            src="/logo-mark-light.svg"
            alt=""
            aria-hidden="true"
            width="52"
            height="52"
          />
          <span>destina</span>
        </a>
        <div className="header-tools">
          {s && (
            <div className="room-pill">
              <span className={ended ? "dot ended" : "dot"} />
              <span>
                {s.room.name}
                {!demo && <small>ROOM {s.room.code}</small>}
              </span>
            </div>
          )}
          <button
            className="theme-toggle"
            data-theme-toggle
            type="button"
            aria-label="Toggle light and dark mode"
            title="Toggle light and dark mode"
          >
            <Sun className="theme-dark" size={18} aria-hidden="true" />
            <Moon className="theme-light" size={18} aria-hidden="true" />
            <span className="theme-label theme-dark">Light mode</span>
            <span className="theme-label theme-light">Dark mode</span>
          </button>
        </div>
      </header>
      <main>
        {error && (
          <div className="alert" role="alert">
            <Shield size={17} />
            <span>{error}</span>
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="Dismiss message"
            >
              <X size={17} />
            </button>
          </div>
        )}
        {!joined ? (
          <section className="join-layout">
            <div className="welcome-copy">
              <span className="eyebrow">destina with tina</span>
              <h1>
                Good company.
                <br />
                <em>A little curiosity.</em>
              </h1>
              <p>
                A few interests. A table of people. Tina takes it from there.
              </p>
            </div>
            <section className="panel join-panel">
              <span className="eyebrow">
                {fromChip ? "YOUR PROMPT IS WAITING" : "YOUR TABLE"}
              </span>
              <h2>{room ? room.name : "A place at the table."}</h2>
              <p>
                {fromChip
                  ? "Join your room to open this prompt."
                  : "What should we call you?"}
              </p>
              {room && (
                <div className="room-label">
                  <span className="dot" />
                  {room.playerCount} of 6 players joined
                  {!demo && <span>ROOM {room.code}</span>}
                </div>
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await run("join", "/join", {
                      name,
                      ...(demo ? {} : { code }),
                    })
                  ) {
                    setView("profile");
                  }
                }}
              >
                <label>
                  Your name
                  <input
                    autoComplete="given-name"
                    required
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="What should we call you?"
                  />
                </label>
                {!room && !demo && (
                  <label>
                    Room code
                    <input
                      required
                      value={code}
                      maxLength={6}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="Room code on Tina"
                      autoCapitalize="characters"
                    />
                  </label>
                )}
                <button
                  className="primary full"
                  disabled={!!busy || room?.status === "finished"}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <>
                      {room?.status === "finished"
                        ? "This gathering has ended"
                        : "Join the table"}
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </form>
              <div className="quiet-note">
                <Shield size={16} />
                <p>
                  {fromChip
                    ? "Join on this phone to open your prompts."
                    : "You choose which interests the game uses."}
                </p>
              </div>
              {!requestedRoom && !demo && (
                <p className="scan-note">
                  Tina’s QR code takes you straight to your room.
                </p>
              )}
            </section>
          </section>
        ) : ended ? (
          <section className="center-state">
            <span className="eyebrow">UNTIL THE NEXT GATHERING</span>

            <h1>That’s all for tonight.</h1>
            <p>
              This game has ended. Tina will have a new QR code when the next
              one starts.
            </p>
            <button className="secondary" onClick={() => setView("profile")}>
              Review your profile <ArrowRight size={16} />
            </button>
            {view === "profile" && (
              <Profile s={s} busy={busy} run={run} readOnly />
            )}
          </section>
        ) : (
          <>
            <nav className="player-nav" aria-label="Player pages">
              <button
                className={view === "profile" ? "selected" : ""}
                onClick={() => setView("profile")}
              >
                Profile
              </button>
              <span className="player-name">
                {s.me.name}
                <span className="avatar">{s.me.name[0].toUpperCase()}</span>
              </span>
            </nav>
            {view === "profile" ? (
              <Profile s={s} busy={busy} run={run} />
            ) : (
              <Capsule s={s} onProfile={() => setView("profile")} />
            )}
          </>
        )}
      </main>
      <footer>
        <span>destina with tina</span>
        <span>GOOD COMPANY GOES A LONG WAY</span>
      </footer>
    </div>
  );
}
function Profile({
  s,
  busy,
  run,
  readOnly = false,
}: {
  s: Snapshot;
  busy: string;
  run: (
    key: string,
    path: string,
    body?: unknown,
    method?: string,
  ) => Promise<boolean>;
  readOnly?: boolean;
}) {
  const approved = s.me.interests.filter((i) => i.approved);
  const [introReset, setIntroReset] = useState(0);
  const interestHeading = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState(s.me.interests.map((i) => i.id)),
    [manual, setManual] = useState(""),
    [editing, setEditing] = useState(
      !approved.length || s.me.interests.some((i) => !i.approved),
    ),
    [savedRecently, setSavedRecently] = useState(false),
    [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setSelected(s.me.interests.map((i) => i.id));
    setEditing(
      !s.me.interests.some((i) => i.approved) ||
        s.me.interests.some((i) => !i.approved),
    );
    setManual("");
  }, [JSON.stringify(s.me.interests)]);
  const labels = manual
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const total = new Set([
    ...s.me.interests
      .filter((i) => selected.includes(i.id))
      .map((i) => i.label.toLowerCase()),
    ...labels.map((label) => label.toLowerCase()),
  ]).size;
  const dirty = interestSelectionChanged(s.me.interests, selected, labels);
  const saved = !editing && approved.length > 0;
  const cancel = () => {
    setSelected(approved.map((i) => i.id));
    setManual("");
    setEditing(false);
    setSavedRecently(false);
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      await run("interests", "/interests", {
        labels: manual
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        approvedIds: selected,
      })
    ) {
      setManual("");
      setEditing(false);
      setSavedRecently(true);
    }
  }
  return (
    <section
      className={`profile-page ${readOnly ? "read-only" : ""} ${saved ? "profile-saved" : "profile-editing"} ${s.me.interests.length ? "has-interests" : ""}`}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PROFILE</span>
          <h1>A little about you.</h1>
          <p>A few interests for questions that fit you.</p>
        </div>
      </div>
      {s.notice && (
        <div className="notice" role="status">
          <p>{s.notice}</p>
        </div>
      )}
      <div className="profile-grid">
        <div className="profile-inputs">
          {!readOnly && (
            <VoiceIntro
              key={introReset}
              savedText={
                s.sources.filter((source) => source.kind === "intro").at(-1)
                  ?.text || ""
              }
              busy={!!busy}
              hasInterests={approved.length > 0}
              onSave={async (text) => {
                const saved = await run("intro", "/profile/intro", { text });
                if (saved)
                  requestAnimationFrame(() => {
                    interestHeading.current?.focus();
                    interestHeading.current?.scrollIntoView({ block: "start" });
                  });
                return saved;
              }}
            />
          )}
          <section className="panel source-panel">
            <h2>Your Instagram.</h2>
            <p className="source-intro">
              Meta AI suggests interests from your bio and captions.
            </p>
            {!readOnly && !s.connected && (
              <a
                className="secondary full instagram"
                href="/api/instagram/connect"
              >
                <Instagram size={18} />
                {s.connected ? "Reconnect Instagram" : "Connect Instagram"}
                <ArrowUpRight size={16} />
              </a>
            )}
            <div className="integration-status">
              <span className={s.connected ? "dot" : "dot dim"} />
              {s.connected
                ? "Connected"
                : s.instagramReady
                  ? "Ready to connect"
                  : "You can add interests without connecting"}
            </div>
            {s.sources.some(
              (source) => source.kind !== "manual" && source.kind !== "intro",
            ) && (
              <div className="notice import-summary">
                <p>{importSummary(s.sources)}</p>
              </div>
            )}
            {s.sources.some(
              (source) => source.kind !== "manual" && source.kind !== "intro",
            ) && (
              <p className="imported-text-note">
                Imported text means your bio and post captions.
              </p>
            )}
            {s.sources.some(
              (source) => source.kind !== "manual" && source.kind !== "intro",
            ) && (
              <details className="imported-profile-text">
                <summary>
                  <FileText size={14} />
                  View imported text
                  <span>
                    {
                      s.sources.filter(
                        (source) =>
                          source.kind !== "manual" && source.kind !== "intro",
                      ).length
                    }
                  </span>
                </summary>
                <p>
                  This is the text Instagram shared from your bio and recent
                  post captions. We use it to suggest interests. Only the
                  interests you save are used for prompts.
                </p>
                {s.sources
                  .filter(
                    (source) =>
                      source.kind !== "manual" && source.kind !== "intro",
                  )
                  .map((source) => (
                    <blockquote key={source.id}>
                      <span className="eyebrow">
                        {source.kind === "manual"
                          ? "YOU ADDED"
                          : source.kind.toUpperCase()}
                      </span>
                      <p>{source.text}</p>
                    </blockquote>
                  ))}
              </details>
            )}
            <details className="connection-details">
              <summary>About this connection</summary>
              {!readOnly && s.connected && (
                <a className="text-button" href="/api/instagram/connect">
                  Reconnect Instagram
                </a>
              )}
              <p>
                Business or Creator accounts only. Messages and saved posts are
                never imported.
              </p>
              <p>Your imported text is removed when the room closes.</p>
              {s.sources.some(
                (source) => source.kind !== "manual" && source.kind !== "intro",
              ) && (
                <>
                  {!readOnly && (
                    <button
                      className="secondary full"
                      disabled={!!busy}
                      onClick={() => run("analyze", "/profile/analyze", {})}
                    >
                      {busy === "analyze" ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : null}
                      {busy === "analyze"
                        ? "Finding interests…"
                        : "Refresh suggestions"}
                    </button>
                  )}
                </>
              )}
            </details>
          </section>
        </div>
        <section className="panel interest-panel">
          <h2 ref={interestHeading} tabIndex={-1}>
            Your interests.
          </h2>
          {!saved && <p>Keep what fits. Add anything missing.</p>}
          {saved || readOnly ? (
            <>
              <div className="saved-status" role="status" aria-live="polite">
                <CheckCircle2 size={18} />
                <span>
                  {!approved.length
                    ? "No interests saved"
                    : savedRecently
                      ? "Interests saved"
                      : "Saved"}
                </span>
                {approved.length > 0 && (
                  <span className="saved-count">
                    {approved.length}{" "}
                    {approved.length === 1 ? "interest" : "interests"}
                  </span>
                )}
              </div>

              <ul className="saved-interests" aria-label="Saved interests">
                {approved.map((i) => (
                  <li key={i.id}>
                    <div className="interest-row">
                      <span className="interest-name">
                        {interestLabel(i.label)}
                      </span>
                      {!readOnly && (
                        <button
                          className="interest-toggle"
                          type="button"
                          aria-label={`Remove ${interestLabel(i.label)}`}
                          disabled={!!busy}
                          onClick={() => {
                            setSelected(
                              approved
                                .filter((item) => item.id !== i.id)
                                .map((item) => item.id),
                            );
                            setEditing(true);
                            setSavedRecently(false);
                          }}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {!readOnly && (
                <>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => {
                      setEditing(true);
                      setSavedRecently(false);
                    }}
                  >
                    Edit interests
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {s.me.interests.length ? (
                <div className="interest-choices">
                  <p className="interest-count" aria-live="polite">
                    {selected.length} of {s.me.interests.length} kept
                  </p>
                  {s.me.interests.map((i) => {
                    const kept = selected.includes(i.id);
                    const label = interestLabel(i.label);
                    return (
                      <div
                        key={i.id}
                        className={`interest-row ${kept ? "" : "not-kept"}`}
                      >
                        <span className="interest-name">{label}</span>
                        <span className="interest-state">
                          {kept ? "Kept" : "Not kept"}
                        </span>
                        <button
                          className="interest-toggle"
                          type="button"
                          disabled={!!busy}
                          aria-label={`${kept ? "Remove" : "Keep"} ${label}`}
                          onClick={() =>
                            setSelected(
                              kept
                                ? selected.filter((id) => id !== i.id)
                                : [...selected, i.id],
                            )
                          }
                        >
                          <span aria-hidden="true">{kept ? "×" : "+"}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="interest-empty">
                  <p>Add your own interests, or use Instagram.</p>
                </div>
              )}
              <form id="interests-form" onSubmit={submit}>
                <label>
                  Anything else?
                  <input
                    value={manual}
                    maxLength={600}
                    disabled={!!busy}
                    onChange={(e) => setManual(e.target.value)}
                    placeholder="Climbing, live music, cooking"
                  />
                  <small>Use commas. Up to 12 interests.</small>
                </label>
                <div className="approval-note" aria-live="polite">
                  <span>{dirty ? "Unsaved changes" : "No changes yet"}</span>
                  <span>{total} of 12 selected</span>
                </div>
                {total === 0 && approved.length > 0 && (
                  <p className="inline-error">
                    Keep at least one interest, or add a new one before saving.
                  </p>
                )}
                {total > 12 && (
                  <p className="inline-error" role="alert">
                    Choose no more than 12 interests before saving.
                  </p>
                )}
                <div className="profile-action">
                  <button
                    className="primary full"
                    disabled={!!busy || !dirty || total === 0 || total > 12}
                    type="submit"
                  >
                    {busy === "interests" ? (
                      <>
                        <LoaderCircle className="spin" size={16} />
                        Saving interests…
                      </>
                    ) : approved.length ? (
                      "Save changes"
                    ) : (
                      "Save my interests"
                    )}
                  </button>
                  {approved.length > 0 && (
                    <button
                      className="text-button cancel-edit"
                      type="button"
                      disabled={!!busy}
                      onClick={cancel}
                    >
                      Cancel changes
                    </button>
                  )}
                </div>
              </form>
            </>
          )}
        </section>
      </div>
      {!readOnly && (
        <section className="profile-reset" aria-label="Profile settings">
          {deleting ? (
            <div
              className="reset-confirm"
              role="group"
              aria-labelledby="reset-heading"
            >
              <h2 id="reset-heading">Start fresh?</h2>
              <p>
                This clears your Instagram connection, imported text and all
                interests. Your name and room stay the same. Questions already
                shared with the room stay visible.
              </p>
              <div className="reset-actions">
                <button
                  className="danger"
                  disabled={!!busy}
                  onClick={async () => {
                    if (await run("delete", "/profile", undefined, "DELETE")) {
                      setDeleting(false);
                      setIntroReset((value) => value + 1);
                      setManual("");
                      setEditing(true);
                      setSavedRecently(false);
                    }
                  }}
                >
                  {busy === "delete" ? "Resetting…" : "Reset profile"}
                </button>
                <button
                  className="text-button"
                  disabled={!!busy}
                  autoFocus
                  onClick={() => setDeleting(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => setDeleting(true)}
            >
              Reset profile
            </button>
          )}
        </section>
      )}
    </section>
  );
}
function Capsule({ s, onProfile }: { s: Snapshot; onProfile: () => void }) {
  const [data, setData] = useState<CapsuleSnapshot | null>(null),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  const serial = useRef(0);
  const refresh = async () => {
    const seq = ++serial.current;
    setRefreshing(true);
    try {
      const next: CapsuleSnapshot = await api("/prompt");
      if (seq === serial.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (seq === serial.current) {
        setData(null);
        setError((e as Error).message);
      }
    } finally {
      if (seq === serial.current) setRefreshing(false);
    }
  };
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    const focus = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("pageshow", focus);
    return () => {
      serial.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("pageshow", focus);
    };
  }, [s.room.id]);
  const p = data?.prompt;
  const involved = p?.participants.some((player) => player.id === s.me.id);
  const names = p?.participants
    .map((player) => (player.id === s.me.id ? "You" : player.name))
    .join(" and ");
  return (
    <section className="capsule-page">
      <div className="capsule-heading">
        <span className="eyebrow">YOUR PROMPT</span>
        <span className="live-label">
          <span className="dot" />
          {s.room.name}
        </span>
      </div>
      {error ? (
        <div className="center-state">
          <LockKeyhole size={30} />
          <h1>The question didn’t load.</h1>
          <p>{error}</p>
          <button className="secondary" onClick={refresh}>
            Try again <RefreshCw size={15} />
          </button>
        </div>
      ) : !data ? (
        <div className="center-state">
          <LoaderCircle className="spin" size={24} />
          <p>Finding the current question…</p>
        </div>
      ) : p ? (
        <article className="prompt-card" key={p.id}>
          <div className="prompt-top">
            <span className="eyebrow">
              PROMPT {String(p.number).padStart(2, "0")}
            </span>
            <span className="duration">
              <Clock size={14} />
              {p.duration} seconds
            </span>
          </div>

          <div className="relic-cover">
            <span className="target-label">
              {involved ? "YOUR TURN" : "AT YOUR TABLE"}
            </span>
            <h1>{p.type}</h1>
            <p className="relic-for">{names}</p>
          </div>
          <div className="relic-question" aria-live="polite">
            <h2>{p.title}</h2>
            <p className="prompt-instructions">{p.instructions}</p>
          </div>
          {p.secret ? (
            <div className="private-prompt">
              <LockKeyhole size={19} />
              <div>
                <span className="eyebrow">JUST FOR YOU</span>
                <p>{p.secret}</p>
              </div>
            </div>
          ) : p.type === "Bounty" ? (
            <div className="private-placeholder">
              <LockKeyhole size={15} />
              <p>
                The secret mission is visible only to {p.participants[0]?.name}.
              </p>
            </div>
          ) : null}
          <div className="prompt-bottom">
            You can pass on any question. There’s no need to explain.
          </div>
        </article>
      ) : (
        <div className="waiting-prompt">
          <span className="eyebrow">BETWEEN QUESTIONS</span>
          <h1>Your next prompt.</h1>
          <p>It will appear here when your Game Master is ready.</p>
          {!s.me.interests.some((i) => i.approved) && (
            <button className="secondary" onClick={onProfile}>
              Add your interests while you wait <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      <div className="capsule-foot">
        <span>
          <Shield size={14} />
          Connected to {s.room.name}
        </span>
        <button className="text-button" disabled={refreshing} onClick={refresh}>
          <RefreshCw className={refreshing ? "spin" : ""} size={14} />
          Refresh question
        </button>
      </div>
      <p className="capsule-note">
        This page updates when your Game Master chooses a question.
      </p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  ["/questions", "/gm"].includes(location.pathname.replace(/\/$/, "")) ? (
    <Questions />
  ) : (
    <App />
  ),
);
