import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import type { Player } from "../shared/types";
import { interestLabel } from "./profile-copy";

type Payload = { labels: string[]; approvedIds: string[] };
export function ProfileInterests({
  player,
  busy,
  readOnly,
  run,
  headingRef,
}: {
  player: Player;
  busy: boolean;
  readOnly: boolean;
  run: (
    key: string,
    path: string,
    body?: unknown,
    method?: string,
  ) => Promise<boolean>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const attempted = useRef("");
  const retry = useRef<Payload | null>(null);
  const interests = player.interests.slice(0, 12);
  const signature = JSON.stringify(player.interests);
  async function save(payload: Payload, clearInput = false) {
    if (inFlight.current || busy || readOnly) return;
    inFlight.current = true;
    setSaving(true);
    setStatus("Saving…");
    retry.current = payload;
    try {
      if (await run("interests", "/interests", payload)) {
        retry.current = null;
        if (clearInput) setText("");
        setStatus(
          payload.labels.length || payload.approvedIds.length
            ? "Saved automatically"
            : "Add your first interest to join the game",
        );
      } else setStatus("Couldn’t save. Try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  // New extracted interests join the list immediately; removing any item saves too.
  // Remember a failed attempt so a service failure cannot create a retry loop.
  useEffect(() => {
    if (readOnly || busy || inFlight.current || attempted.current === signature)
      return;
    if (player.interests.some((i) => !i.approved)) {
      attempted.current = signature;
      void save({ labels: [], approvedIds: interests.map((i) => i.id) });
    }
  }, [signature, busy, readOnly]);
  async function add(value = text) {
    if (!value.trim()) return;
    const labels = [
      ...new Set(
        value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
    if (labels.some((label) => label.length < 2 || label.length > 50)) {
      setStatus("Use 2 to 50 characters for each interest.");
      return;
    }
    const total = new Set(
      [...interests.map((i) => i.label), ...labels].map((v) => v.toLowerCase()),
    ).size;
    if (total > 12) {
      setStatus("You can keep up to 12 interests.");
      return;
    }
    await save({ labels, approvedIds: interests.map((i) => i.id) }, true);
  }
  return (
    <section
      className="panel interest-panel"
      aria-labelledby="interests-heading"
    >
      <h2 id="interests-heading" ref={headingRef} tabIndex={-1}>
        Your interests.
      </h2>
      <p>
        Add a few things you’re into. Voice and Instagram can fill this in too.
      </p>
      <div
        className="interest-autosave-status"
        role="status"
        aria-live="polite"
      >
        {saving ? (
          <LoaderCircle className="spin" size={16} />
        ) : interests.length ? (
          <CheckCircle2 size={16} />
        ) : null}
        <span>
          {status ||
            (interests.length
              ? "Saved automatically"
              : "Add your first interest to join the game")}
        </span>
        <span>{interests.length}/12</span>
      </div>
      {interests.length > 0 && (
        <ul className="saved-interests" aria-label="Your interests">
          {interests.map((interest) => (
            <li key={interest.id}>
              <div className="interest-row">
                <span className="interest-name">
                  {interestLabel(interest.label)}
                </span>
                {!readOnly && (
                  <button
                    className="interest-toggle"
                    type="button"
                    disabled={busy || saving}
                    aria-label={`Remove ${interestLabel(interest.label)}`}
                    onClick={() =>
                      save({
                        labels: [],
                        approvedIds: interests
                          .filter((i) => i.id !== interest.id)
                          .map((i) => i.id),
                      })
                    }
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          className="interest-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label htmlFor="new-interest">Add an interest</label>
          <div className="interest-add-controls">
            <input
              id="new-interest"
              value={text}
              maxLength={600}
              disabled={busy || saving}
              placeholder="e.g. climbing"
              enterKeyHint="done"
              onChange={(e) => {
                const value = e.target.value;
                setText(value);
                if (value.endsWith(",")) void add(value);
              }}
              onBlur={() => void add()}
            />
            <button
              className="secondary"
              type="submit"
              disabled={busy || saving || !text.trim()}
            >
              Add
            </button>
          </div>
          <small>
            Press Enter, use a comma, or leave the field. Changes save
            automatically.
          </small>
        </form>
      )}
      {!readOnly && !saving && retry.current && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => save(retry.current!, true)}
        >
          Try saving again
        </button>
      )}
    </section>
  );
}
