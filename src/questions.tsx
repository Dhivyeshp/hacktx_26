import React, { useEffect, useRef, useState } from "react";
import { Sun, Moon, RefreshCw, LockKeyhole } from "lucide-react";
import type { QuestionsSnapshot, Recommendation } from "../shared/types";

async function request(
  path: string,
  body?: unknown,
  method?: string,
): Promise<any> {
  const response = await fetch(`/api/questions/${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data?.error || "Could not reach your room."),
      { status: response.status },
    );
  return data;
}
export function Questions() {
  const room = new URLSearchParams(location.search).get("room") || "";
  const [feed, setFeed] = useState<QuestionsSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState(room),
    [key, setKey] = useState("");
  const [tab, setTab] = useState<"profiles" | "conversation">("profiles");
  const [updated, setUpdated] = useState<number | null>(null);
  const epoch = useRef(0);
  const fetching = useRef(false);
  const accept = (next: QuestionsSnapshot) => {
    setFeed(next);
    setUpdated(Date.now());
    setError("");
    setLoaded(true);
  };
  const failure = (e: any) => {
    if ([401, 403].includes(e.status)) setFeed(null);
    setError(
      e.message || "Connection lost. Your last questions are still here.",
    );
    setLoaded(true);
  };
  async function refresh() {
    if (fetching.current) return;
    fetching.current = true;
    const current = epoch.current;
    try {
      const next = await request(
        `session${feed?.room.code || room ? `?room=${encodeURIComponent(feed?.room.code || room)}` : ""}`,
      );
      if (current === epoch.current) accept(next);
    } catch (e) {
      if (current === epoch.current) failure(e);
    } finally {
      fetching.current = false;
    }
  }
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("access");
    if (token)
      history.replaceState(null, "", location.pathname + location.search);
    let stopped = false;
    (async () => {
      try {
        const next = token
          ? await request("access", { token })
          : await request(
              `session${room ? `?room=${encodeURIComponent(room)}` : ""}`,
            );
        if (!stopped) accept(next);
      } catch (e: any) {
        if (!stopped) {
          if (!token && e.status === 401) setLoaded(true);
          else failure(e);
        }
      }
    })();
    return () => {
      stopped = true;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (!feed) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", visible);
    };
  }, [!!feed]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    epoch.current++;
    try {
      accept(await request("login", { code: code.trim().toUpperCase(), key }));
    } catch (e) {
      failure(e);
    } finally {
      setKey("");
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    epoch.current++;
    try {
      await request("session", undefined, "DELETE");
      setFeed(null);
      setError("");
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  function card(rec: Recommendation, selected = false) {
    const round = feed?.history.find((r) => r.recommendation.id === rec.id);
    return (
      <article
        className={`question-card${selected ? " selected-question" : ""}`}
        key={rec.id}
      >
        <div className="question-meta">
          <span>{rec.type}</span>
          <span>
            {selected || round?.status === "assigned"
              ? "Current question"
              : round?.status === "completed"
                ? "Played"
                : round?.status === "passed"
                  ? "Passed"
                  : "Suggested"}
          </span>
        </div>
        <h3>{rec.title}</h3>
        <p className="question-people">
          {rec.participants
            .map(
              (id) => feed?.players.find((p) => p.id === id)?.name || "Player",
            )
            .join(" and ")}{" "}
          <span>· {rec.duration} seconds</span>
        </p>
        <p className="question-instructions">{rec.instructions}</p>
        {rec.secret && (
          <div className="gm-secret">
            <span>Private mission</span>
            <p>{rec.secret}</p>
          </div>
        )}
        <details>
          <summary>Why this question</summary>
          <p>{rec.reason}</p>
        </details>
        <small className="question-source">
          {rec.mode === "live"
            ? "Muse suggestion"
            : "From the question library"}
        </small>
      </article>
    );
  }
  const batches =
    feed?.batches
      .filter(
        (b) => b.origin === (tab === "profiles" ? "profiles" : "conversation"),
      )
      .slice()
      .reverse() || [];
  const archived =
    feed?.history.filter(
      (r) =>
        !feed.batches.some((b) =>
          b.recommendations.some((q) => q.id === r.recommendation.id),
        ) && r.id !== feed.activeQuestion?.id,
    ) || [];
  return (
    <div className="app-shell questions-shell">
      <header className="header">
        <a className="brand" href="/" aria-label="destina home">
          <img
            className="brand-mark theme-dark"
            src="/logo-mark-dark.svg"
            alt=""
            width="52"
            height="52"
          />
          <img
            className="brand-mark theme-light"
            src="/logo-mark-light.svg"
            alt=""
            width="52"
            height="52"
          />
          <span>destina</span>
        </a>
        <div className="header-tools">
          <button
            className="theme-toggle"
            data-theme-toggle
            type="button"
            aria-label="Toggle light and dark mode"
          >
            <Sun className="theme-dark" size={18} />
            <Moon className="theme-light" size={18} />
          </button>
        </div>
      </header>
      <main className="questions-main">
        {!loaded ? (
          <p role="status">Opening your room…</p>
        ) : !feed ? (
          <section className="questions-login">
            <LockKeyhole size={22} />
            <h1>At the table.</h1>
            <p>A private view for your Game Master.</p>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <form onSubmit={login}>
              <label htmlFor="gm-room">Room code</label>
              <input
                id="gm-room"
                autoComplete="off"
                required
                maxLength={6}
                minLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <label htmlFor="gm-key">Game Master access key</label>
              <input
                id="gm-key"
                type="password"
                autoComplete="off"
                required
                maxLength={512}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="primary" disabled={busy}>
                {busy ? "Opening…" : "Open questions"}
              </button>
            </form>
            <small>
              You can also open the private access link supplied with your room.
            </small>
          </section>
        ) : (
          <>
            <div className="questions-heading">
              <div>
                <span className="eyebrow">
                  GAME MASTER · ROOM {feed.room.code}
                </span>
                <h1>{feed.room.name}</h1>
                <p>
                  {feed.room.readyCount} of {feed.room.playerCount} people
                  ready. Selection happens in Vision Pro.
                </p>
              </div>
              <div className="questions-actions">
                <button className="text-button" onClick={() => void refresh()}>
                  <RefreshCw size={16} /> Refresh
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={logout}
                >
                  Close private view
                </button>
              </div>
            </div>
            <section className="gm-roster" aria-labelledby="roster-heading">
              <div className="feed-section-heading">
                <h2 id="roster-heading">Everyone here</h2>
                <span>{feed.players.length} of 6 joined</span>
              </div>
              {feed.players.length ? (
                <ul
                  className="gm-player-list"
                  aria-label="Players in this room"
                >
                  {feed.players.map((player) => (
                    <li key={player.id}>
                      <span className="gm-player-initial" aria-hidden="true">
                        {player.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="gm-player-identity">
                        <strong>{player.name}</strong>
                        <span>
                          {player.ready
                            ? "Interests saved"
                            : "Adding interests"}
                        </span>
                      </div>
                      <span className="gm-player-turns">
                        {player.participation}{" "}
                        {player.participation === 1 ? "turn" : "turns"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="questions-empty">
                  People appear here as they join Tina’s room.
                </p>
              )}
            </section>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            {feed.preparing && (
              <p role="status">Muse is preparing the next questions…</p>
            )}
            {feed.room.status === "finished" ? (
              <p className="questions-empty">This gathering has ended.</p>
            ) : (
              <section className="current-question">
                <div className="feed-section-heading">
                  <h2>On the table</h2>
                  <span aria-live="polite">
                    {feed.activeQuestion
                      ? `Prompt ${String(feed.activeQuestion.number).padStart(2, "0")}`
                      : "Waiting for a selection"}
                  </span>
                </div>
                {feed.activeQuestion ? (
                  card(feed.activeQuestion.recommendation, true)
                ) : (
                  <p className="questions-empty">
                    Your Game Master’s next choice will appear here and on
                    players’ phones.
                  </p>
                )}
              </section>
            )}
            <nav className="feed-tabs" aria-label="Question sources">
              <button
                aria-current={tab === "profiles" ? "page" : undefined}
                onClick={() => setTab("profiles")}
              >
                Profile questions
              </button>
              <button
                aria-current={tab === "conversation" ? "page" : undefined}
                onClick={() => setTab("conversation")}
              >
                Conversation
              </button>
            </nav>
            {tab === "conversation" && (
              <section className="conversation-feed">
                <h2>From the conversation</h2>
                {feed.conversation.status === "not_connected" ? (
                  <p className="questions-empty">
                    The live conversation isn’t connected yet. Transcripts and
                    new suggestions will appear here when it is.
                  </p>
                ) : (
                  <>
                    <p>
                      {feed.conversation.status === "live"
                        ? "Listening"
                        : "Paused"}
                    </p>
                    {feed.conversation.segments.map((segment) => (
                      <p key={segment.id}>
                        <strong>
                          {feed.players.find((p) => p.id === segment.speakerId)
                            ?.name || "Speaker"}
                        </strong>{" "}
                        {segment.text}
                      </p>
                    ))}
                  </>
                )}
              </section>
            )}
            {!batches.length && tab === "profiles" && (
              <p className="questions-empty">
                Questions appear when your Game Master requests the first batch.
                Opening this page doesn’t use Muse credits.
              </p>
            )}
            {batches.map((batch, i) => (
              <section className="question-batch" key={batch.id}>
                <div className="feed-section-heading">
                  <h2>
                    {tab === "profiles"
                      ? "From your people"
                      : "Suggested questions"}
                  </h2>
                  <span>
                    {batch.createdAt
                      ? new Date(batch.createdAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Current suggestions"}{" "}
                    · Set {batches.length - i}
                  </span>
                </div>
                <div className="question-grid">
                  {batch.recommendations.map((rec) => card(rec))}
                </div>
              </section>
            ))}
            {tab === "profiles" && archived.length > 0 && (
              <section className="question-batch">
                <h2>Earlier questions</h2>
                <div className="question-grid">
                  {archived
                    .slice()
                    .reverse()
                    .map((round) => card(round.recommendation))}
                </div>
              </section>
            )}
            <footer className="questions-footer">
              <LockKeyhole size={14} />
              <span>
                Private view ·{" "}
                {updated
                  ? `Updated ${new Date(updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : "Connecting"}
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
