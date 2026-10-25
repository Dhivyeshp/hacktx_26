import React, { useEffect, useState } from "react";
import type { QuestionsSnapshot } from "../shared/types";
import {
  rewardCriteria,
  type PlayerRewards,
  type RewardCriterion,
} from "../shared/rewards";

export function PlayerTokenBalance({
  rewards: r,
}: {
  rewards?: PlayerRewards;
}) {
  if (!r) return null;
  return (
    <section className="token-balance" aria-label="Your Tina Tokens">
      <div>
        <h2>Tina Tokens</h2>
        <span>Solana devnet demo</span>
      </div>
      <p>
        <strong>{r.confirmed}</strong> confirmed{" "}
        <span>
          · {r.pending} awaiting settlement · Level {r.level}
        </span>
      </p>
      <p className="gm-help">
        Earned through contributions confirmed by the Game Master. Passing never
        costs tokens.
      </p>
      <label>
        Shared table goal{" "}
        <span>
          {r.tableApproved} / {r.goal}
        </span>
        <progress value={Math.min(r.tableApproved, r.goal)} max={r.goal} />
      </label>
      {r.goalReached && <p>The table has earned a shared finale.</p>}
      {r.wallet && (
        <a
          className="text-button"
          href={`https://explorer.solana.com/address/${r.wallet}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
        >
          View your devnet wallet
        </a>
      )}
    </section>
  );
}
type Draft = {
  playerId: string;
  criteria: RewardCriterion[];
  evidenceIds: string[];
  note: string;
};
export function GMRewards({
  feed,
  busy,
  act,
}: {
  feed: QuestionsSnapshot;
  busy: boolean;
  act: (path: string, body: unknown) => Promise<boolean>;
}) {
  const r = feed.rewards;
  const [selected, setSelected] = useState("");
  const round =
    r?.rounds.find((x) => x.roundId === selected) || r?.rounds.at(-1);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [goal, setGoal] = useState(r?.goal || 40);
  const [confirm, setConfirm] = useState(false);
  const saved = JSON.stringify(round?.awards || []),
    ids = feed.players.map((p) => p.id).join(",");
  useEffect(() => {
    setDraft(
      feed.players.map((p) => {
        const a = round?.awards.find((a) => a.playerId === p.id);
        return {
          playerId: p.id,
          criteria: a?.criteria || [],
          evidenceIds: a?.evidenceIds || [],
          note: a?.note || "",
        };
      }),
    );
    setConfirm(false);
  }, [round?.roundId, saved, ids, r?.gameId]);
  useEffect(() => setGoal(r?.goal || 40), [r?.goal, r?.gameId]);
  if (!r) return null;
  const locked =
    !!round && ["processing", "failed", "confirmed"].includes(round.settlement);
  const disabled = busy || !feed.canControl || r.paused || locked;
  const draftDirty =
    !!round &&
    (draft.length !== round.awards.length ||
      draft.some((a) => {
        const saved = round.awards.find((x) => x.playerId === a.playerId);
        return (
          !saved ||
          JSON.stringify([
            a.criteria.slice().sort(),
            a.evidenceIds.slice().sort(),
            a.note,
          ]) !==
            JSON.stringify([
              saved.criteria.slice().sort(),
              saved.evidenceIds.slice().sort(),
              saved.note,
            ])
        );
      }));
  function update(id: string, change: Partial<Draft>) {
    setConfirm(false);
    setDraft((rows) =>
      rows.map((row) => (row.playerId === id ? { ...row, ...change } : row)),
    );
  }
  const total = draft.reduce(
    (sum, a) =>
      sum +
      rewardCriteria
        .filter((c) => a.criteria.includes(c.id))
        .reduce((n, c) => n + c.points, 0),
    0,
  );
  return (
    <section
      id="gm-tokens"
      className="gm-rewards"
      aria-labelledby="tokens-heading"
    >
      <div className="feed-section-heading">
        <h2 id="tokens-heading">Tina Tokens</h2>
        <span>
          Solana devnet ·{" "}
          {r.configured ? "Service configured" : "Settlement not configured"}
        </span>
      </div>
      <p className="gm-help">
        Reward thoughtful participation. Every award needs your approval. No
        points for speaking longer, and no penalty for passing.
      </p>
      <div className="token-goal">
        <div>
          <strong>{r.approved}</strong> approved{" "}
          <span>· {r.confirmed} confirmed on devnet</span>
        </div>
        <label>
          Shared finale{" "}
          <span>
            {r.approved} / {r.goal}
          </span>
          <progress value={Math.min(r.approved, r.goal)} max={r.goal} />
        </label>
        {r.approved >= r.goal && (
          <p>
            {r.celebrated
              ? "The shared finale was celebrated."
              : "The table has earned a shared finale. Tina’s celebration is simulated for now."}
          </p>
        )}
        {feed.canControl && (
          <div className="gm-actions">
            {r.approved >= r.goal && !r.celebrated && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => act("rewards/settings", { celebrated: true })}
              >
                Mark finale celebrated
              </button>
            )}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => act("rewards/settings", { paused: !r.paused })}
            >
              {r.paused ? "Resume awards" : "Pause new awards"}
            </button>
          </div>
        )}
        {r.paused && (
          <p role="status">
            New awards and settlements are paused. A settlement already sent may
            still finish.
          </p>
        )}
        {feed.canControl && (
          <details>
            <summary>Table goal settings</summary>
            <form
              className="token-goal-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act("rewards/settings", { goal });
              }}
            >
              <label>
                Goal in Tina Tokens
                <input
                  type="number"
                  min={10}
                  max={1000}
                  value={goal}
                  onChange={(e) => setGoal(Number(e.target.value))}
                />
              </label>
              <button
                className="secondary"
                disabled={
                  busy ||
                  r.rounds.some((x) =>
                    ["processing", "failed", "confirmed"].includes(
                      x.settlement,
                    ),
                  )
                }
              >
                Update goal
              </button>
            </form>
            <p className="gm-help">
              The goal is fixed after settlement starts. The finale is a shared
              game reward, not an extra token payout.
            </p>
          </details>
        )}
      </div>
      <div
        className="token-stats-scroll"
        tabIndex={0}
        role="region"
        aria-label="Player token statistics"
      >
        <table className="token-stats">
          <caption>Everyone’s progress this game</caption>
          <thead>
            <tr>
              <th>Player</th>
              <th>Confirmed</th>
              <th>Pending</th>
              <th>Level</th>
              <th>Completed</th>
              <th>Passed</th>
              <th>Shared partners</th>
              <th>Named speech segments</th>
            </tr>
          </thead>
          <tbody>
            {r.players.map((p) => (
              <tr key={p.playerId}>
                <th scope="row">
                  {feed.players.find((x) => x.id === p.playerId)?.name}
                </th>
                <td>{p.confirmed}</td>
                <td>{p.pending}</td>
                <td>{p.level}</td>
                <td>{p.completed}</td>
                <td>{p.passed}</td>
                <td>{p.connections}</td>
                <td>{p.confirmedSpeechSegments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="token-breakdown">
        <summary>Award breakdown and wallets</summary>
        {r.players.map((p) => (
          <div key={p.playerId}>
            <h3>{feed.players.find((x) => x.id === p.playerId)?.name}</h3>
            <p className="gm-help">
              {rewardCriteria
                .map((c) => `${c.label} ${p.breakdown[c.id]}`)
                .join(" · ")}
            </p>
            {p.wallet ? (
              <a
                className="text-button"
                href={`https://explorer.solana.com/address/${p.wallet}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
              >
                View devnet wallet
              </a>
            ) : (
              <p className="gm-help">
                A wallet will be created at first settlement.
              </p>
            )}
          </div>
        ))}
      </details>
      <div className="token-review">
        <h3>Round awards</h3>
        {!r.rounds.length ? (
          <p className="gm-help">
            Complete or pass a prompt to review its awards.
          </p>
        ) : (
          <>
            <label>
              Round to review
              <select
                value={round?.roundId || ""}
                onChange={(e) => setSelected(e.target.value)}
              >
                {[...r.rounds].reverse().map((x) => (
                  <option key={x.roundId} value={x.roundId}>
                    Round {x.number} · {x.title} · {x.settlement}
                  </option>
                ))}
              </select>
            </label>
            <p className="gm-help">
              {round?.status === "passed"
                ? "Passed rounds earn zero and carry no penalty."
                : "Choose observed actions. Bonuses need a short note or confirmed speech evidence. Maximum 10 Tina Tokens per player per round."}
            </p>
            <div className="token-award-grid">
              {draft.map((a) => {
                const p = feed.players.find((p) => p.id === a.playerId);
                const speech = feed.conversation.segments.filter(
                  (seg) =>
                    seg.origin === "microphone" &&
                    seg.roundId === round?.roundId &&
                    seg.speakerId === a.playerId,
                );
                const suggestions = r.suggestions.filter(
                  (x) =>
                    x.roundId === round?.roundId && x.playerId === a.playerId,
                );
                const points = rewardCriteria
                  .filter((c) => a.criteria.includes(c.id))
                  .reduce((n, c) => n + c.points, 0);
                return (
                  <fieldset
                    key={a.playerId}
                    disabled={disabled || round?.status === "passed"}
                  >
                    <legend>
                      {p?.name} <span>{points} Tina Tokens</span>
                    </legend>
                    {rewardCriteria.map((c) => (
                      <label className="gm-check" key={c.id}>
                        <input
                          type="checkbox"
                          checked={a.criteria.includes(c.id)}
                          onChange={(e) =>
                            update(a.playerId, {
                              criteria: e.target.checked
                                ? [...a.criteria, c.id]
                                : a.criteria.filter((x) => x !== c.id),
                            })
                          }
                        />
                        {c.label} <span>+{c.points}</span>
                      </label>
                    ))}
                    <label>
                      GM observation
                      <input
                        maxLength={240}
                        value={a.note}
                        onChange={(e) =>
                          update(a.playerId, { note: e.target.value })
                        }
                        placeholder="What did you notice?"
                      />
                    </label>
                    {!!speech.length && (
                      <details>
                        <summary>Speech evidence</summary>
                        {speech.map((seg) => (
                          <label className="gm-check" key={seg.id}>
                            <input
                              type="checkbox"
                              checked={a.evidenceIds.includes(seg.id)}
                              disabled={
                                !a.evidenceIds.includes(seg.id) &&
                                a.evidenceIds.length >= 6
                              }
                              onChange={(e) =>
                                update(a.playerId, {
                                  evidenceIds: e.target.checked
                                    ? [...a.evidenceIds, seg.id]
                                    : a.evidenceIds.filter(
                                        (id) => id !== seg.id,
                                      ),
                                })
                              }
                            />
                            {seg.text.slice(0, 140)}
                          </label>
                        ))}
                      </details>
                    )}
                    {!!suggestions.length && (
                      <details>
                        <summary>Muse suggestions for review</summary>
                        {suggestions.map((suggestion, i) => (
                          <p className="gm-help" key={i}>
                            {suggestion.reason}
                          </p>
                        ))}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            update(a.playerId, {
                              criteria: [
                                ...new Set([
                                  ...a.criteria,
                                  ...suggestions.map((x) => x.criterion),
                                ]),
                              ],
                              evidenceIds: [
                                ...new Set([
                                  ...a.evidenceIds,
                                  ...suggestions.flatMap((x) => x.evidenceIds),
                                ]),
                              ].slice(0, 6),
                            })
                          }
                        >
                          Use these suggestions
                        </button>
                      </details>
                    )}
                  </fieldset>
                );
              })}
            </div>
            {round?.error && (
              <p className="alert" role="status">
                {round.error}
              </p>
            )}
            {round?.settlement === "processing" && (
              <p role="status">
                Settling on devnet. Balances update here as the result is
                reconciled.
              </p>
            )}
            {round?.settlement === "confirmed" && (
              <p role="status">These awards are confirmed on Solana devnet.</p>
            )}
            {round?.settlement === "approved" && draftDirty && (
              <p className="gm-help" role="status">
                Approve your changes before settling this round.
              </p>
            )}
            {feed.canControl && (
              <div className="gm-actions">
                {!locked && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() =>
                      act("rewards/approve", {
                        roundId: round?.roundId,
                        awards: draft,
                      })
                    }
                  >
                    Approve {total} Tina Tokens
                  </button>
                )}
                {round?.settlement !== "unreviewed" &&
                  round?.settlement !== "confirmed" && (
                    <>
                      {confirm ? (
                        <>
                          <button
                            className="secondary"
                            disabled={busy || r.paused || draftDirty}
                            onClick={async () => {
                              if (
                                await act("rewards/settle", {
                                  roundId: round?.roundId,
                                })
                              )
                                setConfirm(false);
                            }}
                          >
                            Confirm devnet settlement
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setConfirm(false)}
                          >
                            Cancel settlement
                          </button>
                          <p className="gm-help">
                            This sends the saved awards to Solana devnet.
                            Amounts become fixed. Retries reconcile the same
                            awards.
                          </p>
                        </>
                      ) : (
                        <button
                          className="secondary"
                          disabled={
                            busy ||
                            r.paused ||
                            !r.configured ||
                            draftDirty ||
                            round?.settlement === "processing" ||
                            !round?.awards.some((a) => a.points > 0)
                          }
                          onClick={() => setConfirm(true)}
                        >
                          {round?.settlement === "failed"
                            ? "Retry devnet settlement"
                            : "Settle on Solana devnet"}
                        </button>
                      )}
                    </>
                  )}
              </div>
            )}
            {!!round?.awards.some((a) => a.signature) && (
              <details>
                <summary>Confirmed transactions</summary>
                {round.awards
                  .filter((a) => a.signature)
                  .map((a) => (
                    <p key={a.playerId}>
                      <a
                        href={`https://explorer.solana.com/tx/${a.signature}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {feed.players.find((p) => p.id === a.playerId)?.name} ·{" "}
                        {a.points} Tina Tokens
                      </a>
                    </p>
                  ))}
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
