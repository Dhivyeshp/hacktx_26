import React, { useEffect, useRef, useState } from "react";
import { Sun, Moon, RefreshCw, LockKeyhole } from "lucide-react";
import { captureRoomAudio, type AudioHandle } from "./live-audio";
import { GMRewards } from "./rewards";
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
  const [demo, setDemo] = useState(false);
  const [feed, setFeed] = useState<QuestionsSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState(room),
    [key, setKey] = useState("");
  const [privateLink, setPrivateLink] = useState("");
  const [linkNotice, setLinkNotice] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);
  const [target, setTarget] = useState("");
  const [context, setContext] = useState("");
  const [editing, setEditing] = useState("");
  const [instructions, setInstructions] = useState("");
  const [consent, setConsent] = useState(false);
  const [audioStatus, setAudioStatus] = useState("idle");
  const [testText, setTestText] = useState("");
  const [testSpeaker, setTestSpeaker] = useState("Speaker A");
  const [clearTranscript, setClearTranscript] = useState(false);
  const [resetGame, setResetGame] = useState(false);
  const [tinaTicket, setTinaTicket] = useState("");
  const audio = useRef<AudioHandle | null>(null);
  const audioEpoch = useRef(0);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const fetching = useRef(false);
  const accept = (next: QuestionsSnapshot) => {
    setFeed(next);
    setUpdated(Date.now());
    setError("");
    setLoaded(true);
  };
  const failure = (e: any) => {
    if ([401, 403].includes(e.status)) {
      audioEpoch.current++;
      audio.current?.stop();
      setFeed(null);
    }
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
        const config = await fetch("/api/demo", { cache: "no-store" }).then(
          (r) => {
            if (!r.ok)
              throw new Error("The demo could not be opened. Please refresh.");
            return r.json();
          },
        );
        if (!stopped) setDemo(config.enabled);
        const next =
          token && !config.enabled
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
  useEffect(
    () => () => {
      mounted.current = false;
      audioEpoch.current++;
      audio.current?.stop();
    },
    [],
  );
  async function logout() {
    audioEpoch.current++;
    audio.current?.stop();
    setTinaTicket("");
    setPrivateLink("");
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
  async function act(path: string, body: unknown = {}) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await request(path, body);
      await refresh();
      return true;
    } catch (e: any) {
      if (e.status === 401) {
        audioEpoch.current++;
        audio.current?.stop();
        setFeed(null);
      }
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function createPrivateLink() {
    setBusy(true);
    setError("");
    try {
      const grant = await request("invite", {});
      setPrivateLink(grant.url);
      setLinkNotice("Open once within 10 minutes. Keep this link private.");
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  async function generate(origin: "profiles" | "conversation" | "library") {
    await act("recommendations", {
      origin,
      targetPlayerId: target || undefined,
      context,
      replace: true,
    });
  }
  async function startListening() {
    const attempt = ++audioEpoch.current;
    setAudioStatus("starting");
    setError("");
    try {
      const ticket = await request("audio-ticket", {
        consent,
        format: "container",
      });
      if (attempt !== audioEpoch.current) return;
      const handle = await captureRoomAudio(
        ticket,
        (state) => {
          if (mounted.current && attempt === audioEpoch.current)
            setAudioStatus(state);
        },
        (message) => {
          if (mounted.current && attempt === audioEpoch.current)
            setError(message);
        },
        () => attempt !== audioEpoch.current || !mounted.current,
      );
      if (!mounted.current || attempt !== audioEpoch.current) handle.stop();
      else audio.current = handle;
    } catch (e: any) {
      if (attempt !== audioEpoch.current) return;
      setAudioStatus("idle");
      setError(
        e.name === "NotAllowedError"
          ? "Microphone access was denied. Use transcript testing or allow access and try again."
          : e.message,
      );
    }
  }
  async function prepareTina() {
    setError("");
    try {
      const ticket = await request("audio-ticket", {
        consent,
        format: "linear16",
      });
      setTinaTicket(ticket.token);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function pauseListening() {
    audioEpoch.current++;
    audio.current?.stop();
    setAudioStatus("idle");
    await act("conversation", { action: "pause" });
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
        {feed?.canControl &&
          feed.availableIds.includes(rec.id) &&
          !feed.activeQuestion && (
            <div className="gm-card-controls">
              {editing === rec.id && (
                <label>
                  Prompt wording
                  <textarea
                    value={instructions}
                    maxLength={1200}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </label>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  feed.room.readyCount < (demo ? 2 : 3) ||
                  feed.room.readyCount !== feed.room.playerCount ||
                  (editing === rec.id && instructions.trim().length < 15)
                }
                onClick={async () => {
                  if (
                    await act("assign", {
                      recommendationId: rec.id,
                      ...(editing === rec.id ? { instructions } : {}),
                    })
                  ) {
                    setEditing("");
                  }
                }}
              >
                Use this prompt
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (editing === rec.id) setEditing("");
                  else {
                    setEditing(rec.id);
                    setInstructions(rec.instructions);
                  }
                }}
              >
                {editing === rec.id ? "Cancel edit" : "Edit wording"}
              </button>
            </div>
          )}
        {feed?.canControl &&
          !selected &&
          !round &&
          !feed.availableIds.includes(rec.id) && (
            <p className="muted">
              Saved from an earlier set. Prepare fresh options above to choose
              the next prompt.
            </p>
          )}
        <small className="question-source">
          {rec.mode === "live"
            ? "Muse suggestion"
            : "From the question library"}
        </small>
      </article>
    );
  }
  const batches = feed?.batches.slice().reverse() || [];
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
            <h1>Game Master</h1>
            <p>Your room, live conversation and next prompts.</p>
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
                  {demo
                    ? "GAME MASTER · DEMO"
                    : `GAME MASTER · ROOM ${feed.room.code}`}
                </span>
                <h1>{feed.room.name}</h1>
                <p>
                  {feed.room.readyCount} of {feed.room.playerCount} people
                  ready.{" "}
                  {feed.canControl
                    ? "Everything for this gathering, together."
                    : "This is a read-only view."}
                </p>
              </div>
              <div className="questions-actions">
                <button className="text-button" onClick={() => void refresh()}>
                  <RefreshCw size={16} /> Refresh
                </button>
                {!demo && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={logout}
                  >
                    Close private view
                  </button>
                )}
              </div>
            </div>
            <nav className="gm-shortcuts" aria-label="Game Master workspace">
              <a href="#gm-current">Current prompt</a>
              <a href="#gm-conversation">Live conversation</a>
              <a href="#gm-suggestions">Next prompts</a>
              <a href="#roster-heading">Players</a>
              <a href="#gm-tokens">Tina Tokens</a>
            </nav>
            {feed.canControl && !demo && (
              <details className="gm-access">
                <summary>Open on another device</summary>
                <p className="gm-help">
                  Create a private Game Master link for the deployed app. Your
                  player login stays separate. Bookmark /gm on that device after
                  opening it; access lasts 12 hours.
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={createPrivateLink}
                >
                  Create private access link
                </button>
                {privateLink && (
                  <div className="gm-access-link">
                    <label>
                      Private Game Master link
                      <input value={privateLink} readOnly />
                    </label>
                    <div className="gm-actions">
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(privateLink);
                            setLinkNotice(
                              "Copied. Open once within 10 minutes.",
                            );
                          } catch {
                            setLinkNotice("Select and copy the link above.");
                          }
                        }}
                      >
                        Copy link
                      </button>
                      <a
                        className="text-button"
                        href={privateLink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open deployed Game Master
                      </a>
                      <button
                        className="text-button"
                        onClick={() => {
                          setPrivateLink("");
                          setLinkNotice("");
                        }}
                      >
                        Hide link
                      </button>
                    </div>
                    <p className="gm-help" role="status">
                      {linkNotice}
                    </p>
                  </div>
                )}
              </details>
            )}
            {demo && (
              <p className="gm-help">
                One shared demo. Players join at{" "}
                <a href="/join" target="_blank" rel="noreferrer">
                  /join
                </a>{" "}
                and open their question at{" "}
                <a href="/prompt" target="_blank" rel="noreferrer">
                  /prompt
                </a>
                . Anyone with /gm can view this conversation and control the
                game.
              </p>
            )}
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
            {feed.notice && (
              <p className="gm-notice" role="status">
                {feed.notice}
              </p>
            )}
            <div className="gm-dashboard">
              {feed.canControl && feed.room.status !== "finished" && (
                <section
                  className="gm-workbench"
                  aria-labelledby="game-controls-heading"
                >
                  <h2 id="game-controls-heading">The next prompt</h2>
                  {(feed.room.playerCount < (demo ? 2 : 3) ||
                    feed.room.readyCount !== feed.room.playerCount) && (
                    <p className="gm-help" role="status">
                      {feed.room.playerCount < (demo ? 2 : 3)
                        ? `Waiting for at least ${demo ? 2 : 3} players to join.`
                        : "Waiting for everyone to add at least one interest."}
                    </p>
                  )}
                  <div className="gm-control-fields">
                    <label>
                      Spotlight
                      <select
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        disabled={busy || !!feed.activeQuestion}
                      >
                        <option value="">Let the game balance turns</option>
                        {feed.players.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      A little context{" "}
                      <span className="optional">optional</span>
                      <input
                        value={context}
                        maxLength={800}
                        onChange={(e) => setContext(e.target.value)}
                        placeholder="A relaxed first meeting"
                      />
                    </label>
                  </div>
                  <div className="gm-actions">
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        feed.preparing ||
                        !!feed.activeQuestion ||
                        feed.room.readyCount < (demo ? 2 : 3) ||
                        feed.room.readyCount !== feed.room.playerCount
                      }
                      onClick={() => generate("profiles")}
                    >
                      {busy ? "Working…" : "Get three Muse prompts"}
                    </button>
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        feed.preparing ||
                        !!feed.activeQuestion ||
                        feed.room.readyCount < (demo ? 2 : 3) ||
                        feed.room.readyCount !== feed.room.playerCount
                      }
                      onClick={() => generate("library")}
                    >
                      Use the question library
                    </button>
                  </div>
                  <p className="gm-help">
                    Muse generation replaces the current options and uses
                    credits. The library is free.{" "}
                    {feed.conversation.requestCount}/
                    {feed.conversation.requestLimit} question-generation
                    attempts used, including repairs.
                  </p>
                </section>
              )}
              {feed.preparing && (
                <p role="status">Muse is preparing the next questions…</p>
              )}
              {feed.room.status === "finished" ? (
                <p className="questions-empty">This gathering has ended.</p>
              ) : (
                <section className="current-question" id="gm-current">
                  <div className="feed-section-heading">
                    <h2>On the table</h2>
                    <span aria-live="polite">
                      {feed.activeQuestion
                        ? `Prompt ${String(feed.activeQuestion.number).padStart(2, "0")}`
                        : "Waiting for a selection"}
                    </span>
                  </div>
                  {feed.activeQuestion ? (
                    <>
                      {card(feed.activeQuestion.recommendation, true)}
                      {feed.canControl && (
                        <div className="gm-round-actions">
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              act("clear", { status: "completed" })
                            }
                          >
                            Mark completed
                          </button>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => act("clear", { status: "passed" })}
                          >
                            Pass this prompt
                          </button>
                          <a
                            className="text-button"
                            href="/prompt"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open player view
                          </a>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="questions-empty">
                      Your Game Master’s next choice will appear here and on
                      players’ phones.
                    </p>
                  )}
                </section>
              )}
              <section className="conversation-feed" id="gm-conversation">
                <div className="feed-section-heading">
                  <h2>Live conversation</h2>
                  <span>
                    {feed.conversation.status === "live"
                      ? "Listening"
                      : feed.conversation.status === "paused"
                        ? "Paused"
                        : "Not listening"}
                  </span>
                </div>
                {feed.conversation.notice && (
                  <p role="status" className="gm-help">
                    {feed.conversation.notice}
                  </p>
                )}
                {feed.canControl && (
                  <>
                    <div className="gm-recording-controls">
                      <label className="gm-check">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        Everyone at the table agrees to transcription.
                      </label>
                      <div className="gm-actions">
                        {audioStatus !== "idle" ||
                        feed.conversation.status === "live" ? (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={pauseListening}
                          >
                            {audioStatus === "starting"
                              ? "Cancel connection"
                              : "Pause listening"}
                          </button>
                        ) : (
                          <button
                            className="secondary"
                            disabled={
                              !consent ||
                              !feed.conversation.transcriptionReady ||
                              busy
                            }
                            onClick={startListening}
                          >
                            Listen on this device
                          </button>
                        )}
                      </div>
                      <button
                        className="text-button"
                        disabled={
                          !consent ||
                          !feed.conversation.transcriptionReady ||
                          busy ||
                          feed.conversation.status === "live"
                        }
                        onClick={prepareTina}
                      >
                        Prepare a Tina connection
                      </button>
                      {tinaTicket && (
                        <div className="gm-tina-ticket">
                          <p className="gm-help">
                            One-use Tina audio ticket. Use within 60 seconds as
                            TINA_AUDIO_TICKET in the PCM sender. Keep it
                            private.
                          </p>
                          <input
                            aria-label="Tina audio ticket"
                            value={tinaTicket}
                            readOnly
                          />
                          <button
                            className="text-button"
                            onClick={() => setTinaTicket("")}
                          >
                            Hide ticket
                          </button>
                        </div>
                      )}
                      <p className="gm-help">
                        {feed.conversation.transcriptionReady
                          ? "Audio goes to Deepgram for transcription and is billed separately. Pause while Tina reads instructions. Leaving this tab stops this device’s mic."
                          : "Add DEEPGRAM_API_KEY on the server to enable live transcription. Test text works below."}
                      </p>
                      <label className="gm-check">
                        <input
                          type="checkbox"
                          checked={feed.conversation.automatic}
                          disabled={busy}
                          onChange={(e) =>
                            act("conversation", { automatic: e.target.checked })
                          }
                        />
                        Prepare conversation prompts after each turn.
                      </label>
                      <div className="gm-actions">
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            !!feed.activeQuestion ||
                            feed.preparing ||
                            feed.room.readyCount < (demo ? 2 : 3) ||
                            feed.room.readyCount !== feed.room.playerCount
                          }
                          onClick={() => generate("conversation")}
                        >
                          Prepare conversation prompts
                        </button>
                      </div>
                      <p className="gm-help">
                        Requires 40 new transcript words. At most one
                        conversation batch per turn. Refreshing the page is
                        free.
                      </p>
                    </div>
                    <details className="gm-test-transcript">
                      <summary>Test with pasted conversation</summary>
                      <p className="gm-help">
                        Adds clearly labeled test text without transcription
                        charges. Requesting Muse prompts still uses credits.
                      </p>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (
                            await act("transcript", {
                              id: crypto.randomUUID(),
                              text: testText,
                              speakerLabel: testSpeaker.trim() || undefined,
                            })
                          )
                            setTestText("");
                        }}
                      >
                        <label>
                          Speaker label
                          <input
                            value={testSpeaker}
                            maxLength={100}
                            onChange={(e) => setTestSpeaker(e.target.value)}
                          />
                        </label>
                        <label>
                          Test transcript
                          <textarea
                            value={testText}
                            maxLength={1600}
                            rows={4}
                            onChange={(e) => setTestText(e.target.value)}
                          />
                        </label>
                        <button
                          className="secondary"
                          disabled={busy || !testText.trim()}
                        >
                          Add test transcript
                        </button>
                      </form>
                    </details>
                  </>
                )}
                {feed.conversation.segments.length > 0 && (
                  <>
                    {feed.canControl &&
                      feed.conversation.speakerHints.length > 0 && (
                        <section
                          className="gm-speaker-hints"
                          aria-label="Prompt-guided speaker confirmation"
                        >
                          <h3>A voice to a name</h3>
                          <p className="gm-help">
                            The prompt gives us a possible speaker. Confirm only
                            if you recognize who answered.
                          </p>
                          {feed.conversation.speakerHints.map((hint) => (
                            <article
                              key={`${hint.speakerLabel}:${hint.roundId}`}
                            >
                              <h4>Was this {hint.name}?</h4>
                              <blockquote>{hint.excerpt}</blockquote>
                              <small>{hint.speakerLabel}</small>
                              <div className="gm-actions">
                                <button
                                  className="secondary"
                                  disabled={busy || feed.preparing}
                                  onClick={() =>
                                    act("speaker", {
                                      speakerLabel: hint.speakerLabel,
                                      playerId: hint.playerId,
                                    })
                                  }
                                >
                                  Yes, {hint.name}
                                </button>
                                <button
                                  className="text-button"
                                  disabled={busy || feed.preparing}
                                  onClick={() =>
                                    act("speaker", {
                                      speakerLabel: hint.speakerLabel,
                                      playerId: null,
                                      dismissRoundId: hint.roundId,
                                    })
                                  }
                                >
                                  Keep unknown
                                </button>
                              </div>
                            </article>
                          ))}
                        </section>
                      )}
                    <div className="gm-speakers">
                      <h3>Who is speaking?</h3>
                      <p className="gm-help">
                        Confirm a voice after a solo prompt, or use these
                        dropdowns during an optional roll call. Speaker labels
                        reset for each recording connection. Uncertain speech
                        can stay unknown.
                      </p>
                      {Array.from(
                        new Set(
                          feed.conversation.segments.flatMap((segment) =>
                            segment.speakerLabel ? [segment.speakerLabel] : [],
                          ),
                        ),
                      ).map((label) => {
                        const segment = feed.conversation.segments.find(
                          (s) => s.speakerLabel === label,
                        );
                        return (
                          <label key={label}>
                            {label}
                            <select
                              value={segment?.speakerId || ""}
                              disabled={!feed.canControl || busy}
                              onChange={(e) =>
                                act("speaker", {
                                  speakerLabel: label,
                                  playerId: e.target.value || null,
                                })
                              }
                            >
                              <option value="">Unknown player</option>
                              {feed.players.map((player) => (
                                <option key={player.id} value={player.id}>
                                  {player.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                    {feed.conversation.summary && (
                      <details>
                        <summary>Conversation so far</summary>
                        <p>{feed.conversation.summary}</p>
                      </details>
                    )}
                    <ol
                      className="gm-transcript"
                      aria-label="Private conversation transcript"
                    >
                      {feed.conversation.segments.slice(-100).map((segment) => (
                        <li key={segment.id}>
                          <div>
                            <strong>
                              {feed.players.find(
                                (player) => player.id === segment.speakerId,
                              )?.name ||
                                segment.speakerLabel ||
                                "Unknown speaker"}
                            </strong>
                            <span>
                              {segment.origin === "test"
                                ? "Test text"
                                : "Microphone"}{" "}
                              ·{" "}
                              {new Date(segment.at).toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p>{segment.text}</p>
                        </li>
                      ))}
                    </ol>
                    {feed.canControl && (
                      <div className="gm-transcript-clear">
                        {clearTranscript ? (
                          <>
                            <p>
                              Clear this transcript and its summary? Existing
                              questions remain in room history.
                            </p>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={async () => {
                                audio.current?.stop();
                                if (
                                  await act("conversation", { action: "clear" })
                                )
                                  setClearTranscript(false);
                              }}
                            >
                              Clear transcript
                            </button>
                            <button
                              className="text-button"
                              onClick={() => setClearTranscript(false)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="text-button"
                            onClick={() => setClearTranscript(true)}
                          >
                            Clear transcript
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
                {!feed.conversation.segments.length && (
                  <p className="questions-empty">
                    The private transcript will appear here when listening
                    starts or test text is added.
                  </p>
                )}
              </section>
              <div className="gm-suggestions" id="gm-suggestions">
                {!batches.length && (
                  <p className="questions-empty">
                    Questions appear when your Game Master requests the first
                    batch. Opening this page doesn’t use Muse credits.
                  </p>
                )}
                {batches.map((batch, i) => (
                  <section className="question-batch" key={batch.id}>
                    <div className="feed-section-heading">
                      <h2>
                        {batch.origin === "conversation"
                          ? "From the conversation"
                          : "From your people"}
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
                {archived.length > 0 && (
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
              </div>
            </div>
            <GMRewards feed={feed} busy={busy} act={act} />
            {feed.canControl && (
              <section className="gm-reset" aria-label="Reset game">
                {resetGame ? (
                  <>
                    <h2>Start again?</h2>
                    <p>
                      This clears every player, profile, transcript, prompt and
                      recorded turn in this game. Everyone will need to join
                      again. Spending limits stay in place. A new token game
                      starts, while confirmed blockchain history remains.
                    </p>
                    <div className="gm-actions">
                      <button
                        className="secondary"
                        disabled={busy || feed.preparing}
                        onClick={async () => {
                          audioEpoch.current++;
                          audio.current?.stop();
                          setAudioStatus("idle");
                          if (await act("reset", { confirm: true })) {
                            setResetGame(false);
                            setTarget("");
                            setContext("");
                            setEditing("");
                            setInstructions("");
                            setConsent(false);
                            setTestText("");
                            setTestSpeaker("Speaker A");
                            setClearTranscript(false);
                            setTinaTicket("");
                            setPrivateLink("");
                          }
                        }}
                      >
                        Reset game and remove players
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setResetGame(false)}
                      >
                        Keep playing
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className="text-button"
                    disabled={busy || feed.preparing}
                    onClick={() => setResetGame(true)}
                  >
                    Reset game
                  </button>
                )}
              </section>
            )}
            <footer className="questions-footer">
              <LockKeyhole size={14} />
              <span>
                {demo ? "Demo view" : "Private view"} ·{" "}
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
