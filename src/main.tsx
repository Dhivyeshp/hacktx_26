import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
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
  Users,
  X,
} from "lucide-react";
import type {
  Snapshot,
  CapsuleSnapshot,
  InterestSuggestion,
} from "../shared/types";
import "./style.css";
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
  const fromChip = location.pathname === "/c";
  const [s, setS] = useState<Snapshot | null>(null),
    [loaded, setLoaded] = useState(false),
    [view, setView] = useState<"profile" | "ready" | "capsule">(
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
        const [session, target] = await Promise.all([
          api("/session").catch(() => null),
          requestedRoom
            ? api("/rooms/" + encodeURIComponent(requestedRoom))
            : Promise.resolve(null),
        ]);
        if (stopped) return;
        if (target) setRoom(target);
        if (
          session &&
          (!requestedRoom || session.room.code === requestedRoom)
        ) {
          accept(session);
          if (!fromChip)
            setView(
              query.has("connection")
                ? "profile"
                : session.me.interests.some(
                      (i: InterestSuggestion) => i.approved,
                    )
                  ? "ready"
                  : "profile",
            );
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
      } catch {}
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
                <small>ROOM {s.room.code}</small>
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
                {fromChip ? "YOUR RELIC IS WAITING" : "YOUR TABLE"}
              </span>
              <h2>{room ? room.name : "A place at the table."}</h2>
              <p>
                {fromChip
                  ? "Join your room to open this relic."
                  : "What should we call you?"}
              </p>
              {room && (
                <div className="room-label">
                  <span className="dot" />
                  {room.playerCount} of 6 players joined
                  <span>ROOM {room.code}</span>
                </div>
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run("join", "/join", { name, code })) {
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
                {!room && (
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
                    ? "Join on this phone to open your relics."
                    : "You choose which interests the game uses."}
                </p>
              </div>
              {!requestedRoom && (
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
              <Profile
                s={s}
                busy={busy}
                run={run}
                onReady={() => setView("ready")}
                readOnly
              />
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
              <button
                className={view === "ready" ? "selected" : ""}
                onClick={() => setView("ready")}
              >
                At the table
              </button>
              <a className={view === "capsule" ? "selected" : ""} href="/c">
                Relic
              </a>
              <span className="player-name">
                {s.me.name}
                <span className="avatar">{s.me.name[0].toUpperCase()}</span>
              </span>
            </nav>
            {view === "profile" ? (
              <Profile
                s={s}
                busy={busy}
                run={run}
                onReady={() => setView(fromChip ? "capsule" : "ready")}
              />
            ) : view === "ready" ? (
              <section className="ready-layout">
                <div className="ready-main">
                  <span className="eyebrow">YOUR PLACE AT THE TABLE</span>
                  <div className="ready-seal">
                    <span>{s.me.name[0].toUpperCase()}</span>
                  </div>
                  <h1>
                    {s.me.interests.some((i) => i.approved) ? (
                      <>
                        You’re in,
                        <br />
                        <em>{s.me.name}.</em>
                      </>
                    ) : (
                      <>
                        A little more
                        <br />
                        <em>about you.</em>
                      </>
                    )}
                  </h1>
                  <p>
                    {s.me.interests.some((i) => i.approved)
                      ? "You’re ready. Tina will bring your relic."
                      : "A few interests will help us find your questions."}
                  </p>
                  <div className="interest-cloud">
                    {s.me.interests
                      .filter((i) => i.approved)
                      .map((i) => (
                        <span key={i.id}>{i.label}</span>
                      ))}
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setView("profile")}
                  >
                    {s.me.interests.some((i) => i.approved)
                      ? "Edit your profile"
                      : "Add your interests"}
                    <ArrowRight size={15} />
                  </button>
                </div>
                <aside className="panel next-panel">
                  <span className="eyebrow">WHAT HAPPENS NEXT</span>
                  <h2>
                    Something to
                    <br />
                    talk about.
                  </h2>
                  <div className="next-copy">
                    <p>Your Game Master is choosing the next question.</p>
                    <p>Tap the chip inside your relic to open it here.</p>
                  </div>
                  <a className="secondary full" href="/c">
                    Your relic <ArrowUpRight size={16} />
                  </a>
                  <div className="quiet-note">
                    <LockKeyhole size={15} />
                    <p>Private missions stay on the assigned player’s phone.</p>
                  </div>
                </aside>
              </section>
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
  onReady,
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
  onReady: () => void;
  readOnly?: boolean;
}) {
  const approved = s.me.interests.filter((i) => i.approved);
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
          {s.sources.some((source) => source.kind !== "manual") && (
            <div className="notice import-summary">
              <p>{importSummary(s.sources)}</p>
            </div>
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
            {s.sources.some((source) => source.kind !== "manual") && (
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
        <section className="panel interest-panel">
          <h2>Your interests.</h2>
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
                    {approved.length} interests
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
                  <div className="profile-action">
                    <button
                      className="primary full"
                      disabled={!!busy}
                      onClick={onReady}
                    >
                      Back to the table <ArrowRight size={17} />
                    </button>
                  </div>
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

          {s.sources.some((source) => source.kind !== "manual") && (
            <details>
              <summary>
                <FileText size={14} />
                Imported text
                <span>
                  {
                    s.sources.filter((source) => source.kind !== "manual")
                      .length
                  }
                </span>
              </summary>
              {s.sources
                .filter((source) => source.kind !== "manual")
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
          {deleting ? (
            <div className="delete-confirm">
              <p>
                Remove your connection, imported text, and interests? Already
                assigned questions stay with the room.
              </p>
              <button
                className="danger"
                disabled={!!busy}
                onClick={async () => {
                  if (await run("delete", "/profile", undefined, "DELETE"))
                    setDeleting(false);
                }}
              >
                Delete profile data
              </button>
              <button
                className="text-button"
                onClick={() => setDeleting(false)}
              >
                Keep my profile
              </button>
            </div>
          ) : (
            <button
              className="text-button muted"
              onClick={() => setDeleting(true)}
            >
              Remove profile
            </button>
          )}
        </section>
      </div>
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
      const next: CapsuleSnapshot = await api("/capsule");
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
    return () => {
      serial.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [s.room.id]);
  const p = data?.prompt;
  return (
    <section className="capsule-page">
      <div className="capsule-heading">
        <span className="eyebrow">YOUR RELIC</span>
        <span className="live-label">
          <span className="dot" />
          YOUR ROOM’S CURRENT RELIC
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
              RELIC {String(p.number).padStart(2, "0")} / {p.type.toUpperCase()}
            </span>
            <span className="duration">
              <Clock size={14} />
              {p.duration} seconds
            </span>
          </div>

          <span className="target-label">
            {p.isTarget
              ? "THIS ONE IS FOR YOU"
              : `FOR ${p.participants[0]?.name.toUpperCase()}`}
          </span>
          <h1>{p.title}</h1>
          <p className="prompt-instructions">{p.instructions}</p>
          <div className="prompt-players">
            <Users size={15} />
            {p.participants.map((p) => p.name).join(" & ")}
          </div>
          {p.secret ? (
            <div className="private-prompt">
              <LockKeyhole size={19} />
              <div>
                <span className="eyebrow">FOR YOUR EYES ONLY</span>
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
          <h1>
            A moment
            <br />
            <em>between relics.</em>
          </h1>
          <p>Your next question will appear here.</p>
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
          Check for a new question
        </button>
      </div>
      <p className="capsule-note">Your relic follows your room.</p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
