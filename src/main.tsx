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
  Upload,
  Users,
  X,
} from "lucide-react";
import type {
  Snapshot,
  CapsuleSnapshot,
  InterestSuggestion,
} from "../shared/types";
import "./style.css";
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
        <a className="brand" href="/">
          <span>
            DESTINA<small>A GAME WITH THE PEOPLE HERE.</small>
          </span>
        </a>
        {s && (
          <div className="room-pill">
            <span className={ended ? "dot ended" : "dot"} />
            <span>
              {s.room.name}
              <small>ROOM {s.room.code}</small>
            </span>
          </div>
        )}
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
              <span className="eyebrow">DESTINA WITH TINA</span>
              <h1>
                Good company.
                <br />
                <em>A little curiosity.</em>
              </h1>
              <p>
                A few things you’re into can lead to a conversation you didn’t
                expect. Tina will bring the relics.
              </p>
              <div className="welcome-foot">
                <span>
                  <Shield size={15} /> You choose what to share
                </span>
                <span>
                  <Users size={15} /> Your people, around one table
                </span>
              </div>
            </div>
            <section className="panel join-panel">
              <span className="eyebrow">
                {fromChip ? "YOUR RELIC IS WAITING" : "YOUR TABLE"}
              </span>
              <h2>{room ? room.name : "A place at the table."}</h2>
              <p>
                {fromChip
                  ? "Join your room first so we can show you the right prompt."
                  : "You found Tina. Now we just need your name."}
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
                    ? "Every relic opens the same page. Joining connects this phone to your room."
                    : "Your profile helps us suggest interests. Nothing enters the game until you approve it."}
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
                Your profile
              </button>
              <button
                className={view === "ready" ? "selected" : ""}
                onClick={() => setView("ready")}
              >
                Your place
              </button>
              <a className={view === "capsule" ? "selected" : ""} href="/c">
                Your relic
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
                      ? "Your profile is ready. You can put your phone away until Tina brings a relic."
                      : "Add a few interests so the questions feel a little more like you."}
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
                    <p>
                      The Game Master is choosing a question for your table,
                      using the interests everyone has shared.
                    </p>
                    <p>
                      When Tina brings a relic, hold your phone near the chip
                      inside. Your question will open here.
                    </p>
                  </div>
                  <a className="secondary full" href="/c">
                    Your relic <ArrowUpRight size={16} />
                  </a>
                  <div className="quiet-note">
                    <LockKeyhole size={15} />
                    <p>
                      Private missions are shown only to the assigned player on
                      their joined phone.
                    </p>
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
        <span>DESTINA WITH TINA</span>
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
  const [selected, setSelected] = useState(s.me.interests.map((i) => i.id)),
    [manual, setManual] = useState(""),
    [text, setText] = useState(""),
    [fileError, setFileError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSelected(s.me.interests.map((i) => i.id));
  }, [JSON.stringify(s.me.interests)]);
  const total =
    selected.length +
    manual
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean).length;
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
      onReady();
    }
  }
  return (
    <section className={`profile-page ${readOnly ? "read-only" : ""}`}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PROFILE</span>
          <h1>
            A little
            <br className="mobile-break" />
            <em> about you.</em>
          </h1>
          <p>
            What do you spend your time on? What could you talk about for hours?
            That’s a good place to start.
          </p>
        </div>
      </div>
      <div className="steps">
        <span className="done">
          <Check size={13} /> YOUR ROOM
        </span>
        <i />
        <span className="current">02 YOUR INTERESTS</span>
        <i />
        <span>03 YOUR RELIC</span>
      </div>
      {s.notice && (
        <div className="notice" role="status">
          <p>{s.notice}</p>
        </div>
      )}
      <div className="profile-grid">
        <section className="panel source-panel">
          <span className="eyebrow">01 / YOUR PROFILE</span>
          <h2>The things you’re into.</h2>
          <p>
            Connect Instagram to find interests in your profile and recent
            captions. You’ll choose what feels right.
          </p>
          {!readOnly && (
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
              ? "Profile connected"
              : s.instagramReady
                ? "Ready to connect"
                : "You can also share text or add interests below"}
          </div>
          {s.sources.some((source) => source.kind !== "manual") && (
            <div className="notice" style={{ flexDirection: "column" }}>
              <p>
                Your saved profile has{" "}
                {s.sources.filter((source) => source.kind === "bio").length}{" "}
                profile excerpt(s) and{" "}
                {s.sources.filter((source) => source.kind === "caption").length}{" "}
                captions. Questions use only interests you approve.
              </p>
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
                    : "Find interests in saved profile"}
                </button>
              )}
              {!readOnly && (
                <p>
                  This uses your saved profile. You won’t need to connect
                  Instagram again.
                </p>
              )}
            </div>
          )}
          <p className="fine-print">
            Instagram supports Business and Creator accounts. We read your bio
            and recent captions, never your messages or saved posts.
          </p>
          <div className="or-divider">
            <span />
            OR A FEW WORDS FROM YOU
            <span />
          </div>
          <label>
            Selected profile text
            <textarea
              value={text}
              maxLength={16000}
              rows={5}
              disabled={readOnly}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your bio or a few captions you’d like to share…"
            />
          </label>
          {!readOnly && (
            <>
              <div className="text-actions">
                <input
                  className="file-input"
                  type="file"
                  ref={fileRef}
                  accept=".txt,text/plain"
                  tabIndex={-1}
                  aria-label="Upload profile text file"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setFileError("");
                    if (file.size > 64000) {
                      setFileError("Choose a text file smaller than 64 KB.");
                      return;
                    }
                    const contents = await file.text();
                    if (contents.length > 16000) {
                      setFileError(
                        "Keep your selected text under 16,000 characters.",
                      );
                      return;
                    }
                    setText(contents);
                    e.target.value = "";
                  }}
                />
                <button
                  className="text-button"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} />
                  Upload .txt
                </button>
                <span>Only what you choose to share</span>
              </div>
              {fileError && (
                <p className="inline-error" role="alert">
                  {fileError}
                </p>
              )}
              <button
                className="secondary full"
                disabled={!!busy || !text.trim()}
                onClick={() => run("extract", "/profile/text", { text })}
              >
                {busy === "extract" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : null}
                Find my interests
              </button>
            </>
          )}
          <div className="quiet-note">
            <Shield size={15} />
            <p>
              Shared text is sent to Meta AI to suggest interests. Only approved
              interests shape the game. Source text is removed when the room
              closes.
            </p>
          </div>
        </section>
        <section className="panel interest-panel">
          <span className="eyebrow">02 / YOUR INTERESTS</span>
          <h2>What feels like you?</h2>
          <p>
            Some of these might fit. Others might not. You can remove any of
            them or add something your profile doesn’t show.
          </p>
          {s.me.interests.length ? (
            <div className="interest-choices">
              {s.me.interests.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={selected.includes(i.id)}
                  className={
                    selected.includes(i.id) ? "interest selected" : "interest"
                  }
                  onClick={() =>
                    setSelected(
                      selected.includes(i.id)
                        ? selected.filter((id) => id !== i.id)
                        : [...selected, i.id],
                    )
                  }
                >
                  <span aria-hidden="true">
                    {selected.includes(i.id) ? "✓" : "+"}
                  </span>
                  {i.label}
                  {selected.includes(i.id) && <Check size={13} />}
                </button>
              ))}
            </div>
          ) : (
            <div className="interest-empty">
              <h3>Nothing here yet.</h3>
              <p>
                Connect your profile, share a little text,
                <br />
                or add your interests below.
              </p>
            </div>
          )}
          <form id="interests-form" onSubmit={submit}>
            <label>
              Add a few more
              <input
                value={manual}
                maxLength={600}
                disabled={readOnly}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Climbing, live music, cooking…"
              />
              <small>Separate interests with commas. Up to 12 total.</small>
            </label>
            <div className="approval-note">
              <CheckCircle2 size={15} />
              <span>Only your selections go into the game.</span>
              <span>{total}/12 selected</span>
            </div>
            {!readOnly && (
              <div className="profile-action">
                <button
                  className="primary full"
                  disabled={!!busy || total === 0 || total > 12}
                  type="submit"
                >
                  {busy === "interests" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <>
                      Save my interests
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </div>
            )}
          </form>
          <p className="fine-print under-save">
            You can change these whenever you like. Nothing is used until you
            choose it.
          </p>
          {s.sources.length > 0 && (
            <details>
              <summary>
                <FileText size={14} />
                The profile text we used
                <span>{s.sources.length}</span>
              </summary>
              {s.sources.map((source) => (
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
          <div className="privacy-bottom">
            <LockKeyhole size={16} />
            <p>
              Your profile stays in this room.
              <br />
              You can remove it whenever you like.
            </p>
          </div>
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
              Disconnect & delete my profile data
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
          <p>
            Your Game Master hasn’t assigned a question yet. This page will
            update when the next relic is ready.
          </p>
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
      <p className="capsule-note">
        Every relic opens this page. The question follows your room, not the
        individual chip.
      </p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
