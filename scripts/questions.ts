import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { openDb, getSession } from "../server/db";
import { fallback, recommend } from "../server/ai";
import type { Player, Recommendation } from "../shared/types";

const args = process.argv.slice(2);
const code = args.find((a) => !a.startsWith("--"));
if (!code)
  throw new Error(
    "Usage: npm run questions -- ROOMCODE [--sample] [--live] [--serve]",
  );
const db = await openDb();
const room = await getSession(db, code);
await db.close();
if (!room) throw new Error("Room not found");
const s = structuredClone(room);
s.players = s.players.filter((p) => p.interests.some((i) => i.approved));
if (args.includes("--sample")) {
  const samples: [string, string[]][] = [
    ["Mira (sample)", ["Photography", "Hiking", "Indie games"]],
    ["Ash (sample)", ["Cooking", "Worldbuilding", "Live music"]],
  ];
  samples.forEach(([name, labels], index) => {
    if (s.players.length >= 3) return;
    s.players.push({
      id: `preview-${index}`,
      name,
      participation: 0,
      sample: true,
      interests: labels.map((label, i) => ({
        id: `preview-${index}-${i}`,
        label,
        sourceIds: [],
        approved: true,
      })),
    } satisfies Player);
  });
}
if (s.players.length < 3)
  throw new Error(
    "Approve interests for three players, or use --sample to add clearly labeled preview-only players. No extra Instagram accounts needed.",
  );
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      players: s.players,
      context: s.context,
      rounds: s.rounds,
    }),
  )
  .digest("hex")
  .slice(0, 16);
mkdirSync("data/question-previews", { recursive: true });
const cache = `data/question-previews/${s.code}-${fingerprint}.json`;
let result: { recommendations: Recommendation[]; notice?: string };
let reused = false;
if (args.includes("--live")) {
  result = await recommend(s);
  if (result.recommendations.some((r) => r.mode === "live"))
    writeFileSync(cache, JSON.stringify(result));
} else {
  try {
    result = JSON.parse(readFileSync(cache, "utf8"));
    reused = true;
  } catch {
    result = {
      recommendations: fallback(s),
      notice: "Free template preview. No Muse request was made.",
    };
  }
}
const esc = (x: unknown) =>
  String(x).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
// Apply punctuation style to the saved preview without changing its source records.
const prose = (value: string) =>
  esc(
    value
      .replace(/[—–]/g, ", ")
      .replace(/\s+-\s+/g, ", ")
      .replace(/:\s*/g, ". "),
  );
const warnings = (r: Recommendation) => {
  const actor = s.players.find((p) => p.id === r.participants[0]);
  const items: string[] = [];
  if (
    r.type === "Bounty" &&
    !r.secret?.toLowerCase().startsWith((actor?.name || "").toLowerCase() + ",")
  )
    items.push(
      "An edit is needed. The private mission must address the first participant, who receives the secret. This saved candidate does not satisfy the new ownership check.",
    );
  if (
    r.type === "Jinx" &&
    !/simultaneous|same time|count of three/i.test(r.instructions)
  )
    items.push(
      "An edit is needed. Jinx requires simultaneous one-word answers and attempts to find a match. Review the mechanic before use.",
    );
  return items
    .map(
      (x) => `<p class="secret"><b>A note before playing</b><br>${esc(x)}</p>`,
    )
    .join("");
};
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>destina questions</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><meta name="theme-color" content="#262722"><script src="/theme.js"></script><style>
${readFileSync(resolve("public/fonts/fonts.css"), "utf8")}
${readFileSync(resolve("src/design-tokens.css"), "utf8")}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.6 var(--font-ui)}main{max-width:1180px;margin:auto;padding:48px 36px}h1,h2{font-family:var(--font-head);font-style:italic;font-weight:500;line-height:1.1;letter-spacing:-0.01em;text-wrap:balance}h1{font-size:clamp(44px,6vw,72px);margin:24px 0}h2{font-size:40px;margin:0 0 18px}small,.muted{color:var(--text-muted)}.gold{color:inherit;text-transform:uppercase;letter-spacing:.2em;font-size:12px}.grid{margin:40px 0;background:var(--cream);color:var(--ink);padding:0 34px}.card{padding:34px 0;border-bottom:1px solid var(--line-light);display:grid;grid-template-columns:140px minmax(0,1fr);gap:32px;overflow-wrap:anywhere}.card:last-child{border:0}.card .muted{color:var(--ink-muted);font-size:15px}.card p{margin:16px 0}.card .relic-title{font-family:var(--font-title);font-style:normal;font-weight:500;font-size:clamp(48px,5vw,64px);letter-spacing:.03em}.question-number{font:40px var(--font-ui);color:var(--ink-muted);display:block;margin-bottom:18px}.question-meta{font-size:13px;line-height:1.6;color:var(--ink-muted)}.question-meta span{display:block}.instructions{font-size:17px;line-height:1.6;white-space:pre-wrap}.secret{border:1px solid var(--line-light);border-radius:8px;padding:16px 20px;background:var(--cream-2);white-space:pre-wrap;font-size:15px}.panel{margin:28px 0;padding:24px 0;border-top:1px solid var(--line)}.panel h2{font-size:40px}.panel p{max-width:760px}details{font-size:15px}summary{cursor:pointer;min-height:48px;padding:12px 0;border-top:1px solid var(--line-light)}summary:focus-visible{outline:2px solid var(--tan);outline-offset:3px}.card summary:focus-visible{outline-color:var(--tan-deep)}code{overflow-wrap:anywhere;color:var(--text);font-size:13px}.card small{color:var(--ink-muted)}.wordmark{font:500 40px var(--font-title);letter-spacing:.03em;border-bottom:1px solid var(--line);padding-bottom:22px;display:flex;align-items:center;gap:12px}.wordmark img{width:52px;height:52px}.panel .gold{margin-top:20px}@media(max-width:700px){main{padding:30px 22px}.grid{padding:0 22px;margin:30px 0}.card{grid-template-columns:1fr;gap:18px;padding:26px 0}.question-aside{display:flex;gap:22px;align-items:center}.question-number{font-size:32px;margin:0}.question-meta{display:flex;gap:14px;font-size:13px}.instructions{font-size:17px}.panel{margin:24px 0}}

.theme-toggle{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;gap:8px;padding:10px 14px;background:transparent;color:var(--text);border:1px solid var(--line);border-radius:999px;font:13px var(--font-ui);cursor:pointer;margin-left:auto;letter-spacing:normal}.theme-toggle:focus-visible{outline:2px solid var(--focus);outline-offset:3px}.theme-light{display:none}:root[data-theme="light"] .theme-dark{display:none}:root[data-theme="light"] .theme-light{display:inline-block}.preview-brand{display:flex;gap:12px;align-items:center}.preview-intro{max-width:700px}.source-note{font-size:13px;color:var(--text-muted)}.review-tools summary{border-color:var(--line)}.wordmark{justify-content:space-between}.card .relic-title{font-size:clamp(40px,5vw,60px)}@media(max-width:700px){main{padding:24px 16px}.wordmark{font-size:34px;padding-bottom:18px;gap:12px}.wordmark img{width:36px;height:36px}.preview-brand{gap:8px}h1{font-size:44px;margin:26px 0 16px}.preview-intro,.source-note{font-size:14px}.grid{margin:24px 0;padding:0 20px}.card{padding:24px 0}.card .relic-title{font-size:38px}.question-meta{flex-wrap:wrap;gap:8px 14px}.question-meta span{white-space:nowrap}.question-aside{gap:20px}.card p{margin:14px 0}.panel{margin:18px 0;padding:16px 0}.theme-label{display:none!important}.theme-toggle{width:44px;padding:10px}}
</style><main><div class="wordmark"><div class="preview-brand"><img class="theme-dark" src="/logo-mark-dark.svg" alt="" width="52" height="52"><img class="theme-light" src="/logo-mark-light.svg" alt="" width="52" height="52"><span>destina</span></div><button type="button" class="theme-toggle" data-theme-toggle aria-label="Toggle light and dark mode" title="Toggle light and dark mode"><span class="theme-dark" aria-hidden="true">☀</span><span class="theme-light" aria-hidden="true">☾</span><span class="theme-dark theme-label">Light mode</span><span class="theme-light theme-label">Dark mode</span></button></div><h1>Questions for the table.</h1><p class="preview-intro">${esc(s.name)}. Room ${esc(s.code)}.</p><p class="source-note">${reused ? "Saved Muse questions. Refreshing is free." : result.recommendations[0]?.mode === "live" ? "From Muse. Preview only." : "Library preview. No credits used."}</p>
<details class="panel"><summary>Interests from ${s.players.length} players</summary>${s.players
  .map(
    (p) =>
      `<p><b>${esc(p.name)}</b>${p.sample ? ", preview fixture, not an Instagram import" : ""}<br>${esc(
        p.interests
          .filter((i) => i.approved)
          .map((i) => i.label)
          .join(", "),
      )}</p>`,
  )
  .join("")}</details>
<div class="grid">${result.recommendations.map((r, index) => `<article class="card"><aside class="question-aside"><span class="question-number">${String(index + 1).padStart(2, "0")}</span><div class="question-meta"><span>${esc(r.type)}</span><span>${r.duration} seconds</span><span>${r.mode === "live" ? "From Muse" : "From the library"}</span></div></aside><div class="question-body"><h2 class="relic-title">${prose(r.title)}</h2><p class="muted">${esc(r.participants.map((id) => s.players.find((p) => p.id === id)?.name || id).join(" and "))}</p><p class="instructions">${prose(r.instructions)}</p>${r.secret ? `<div class="secret"><b>The private mission</b><p>${prose(r.secret)}</p></div>` : ""}${warnings(r)}<details><summary>Why this question?</summary><p>${prose(r.reason)}</p><small>Based on ${esc(s.players.flatMap((p) => p.interests.filter((i) => r.sourceInterestIds.includes(i.id)).map((i) => `${p.name} chose ${i.label}`)).join("; "))}</small></details></div></article>`).join("")}</div>
<details class="panel review-tools"><summary>Review notes and tools</summary><p>A good question fits the players, follows the rules, and invites a real answer. Edit anything that assumes personal facts.</p><p>Refreshing never calls Muse. New batches are explicit and allow one repair. The local cap is 100 requests, not a dollar limit.</p>${result.notice ? `<p>${esc(result.notice)}</p>` : ""}<p>Saved preview <code>npm run questions -- ${esc(s.code)}${args.includes("--sample") ? " --sample" : ""} --serve</code></p><p>Add <code>--live</code> for a new batch.</p></details></main></html>`;
const output = resolve(`data/question-previews/${s.code}.html`);
writeFileSync(output, html, { mode: 0o600 });
console.log(
  `Preview: ${output}\nSource: ${result.recommendations[0]?.mode}; saved cache reused: ${reused}`,
);
if (args.includes("--serve")) {
  createServer((req, res) => {
    if (
      !["127.0.0.1:3001", "localhost:3001"].includes(req.headers.host || "")
    ) {
      res.writeHead(403).end();
      return;
    }
    if (
      [
        "/logo-mark-dark.svg",
        "/logo-mark-light.svg",
        "/favicon.svg",
        "/app-icon.svg",
      ].includes(req.url || "")
    ) {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(readFileSync(resolve("public", req.url!.slice(1))));
      return;
    }
    if (req.url === "/theme.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(readFileSync(resolve("public/theme.js")));
      return;
    }
    const asset = (req.url || "").match(/^\/fonts\/([a-z0-9-]+\.(?:ttf|css))$/);
    if (asset) {
      const path = resolve("public/fonts", asset[1]);
      if (!existsSync(path)) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader(
        "Content-Type",
        asset[1].endsWith(".css") ? "text/css; charset=utf-8" : "font/ttf",
      );
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.end(readFileSync(path));
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; script-src 'self'; frame-ancestors 'none'",
    );
    res.end(readFileSync(output));
  }).listen(3001, "127.0.0.1", () =>
    console.log("Private preview: http://localhost:3001 (this computer only)"),
  );
}
