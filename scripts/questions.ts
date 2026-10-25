import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const db = openDb();
const room = getSession(db, code);
db.close();
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
const warnings = (r: Recommendation) => {
  const actor = s.players.find((p) => p.id === r.participants[0]);
  const items: string[] = [];
  if (
    r.type === "Bounty" &&
    !r.secret?.toLowerCase().startsWith((actor?.name || "").toLowerCase() + ":")
  )
    items.push(
      "Needs edit: the private mission must address the first participant, who receives the secret. This saved candidate does not satisfy the new ownership check.",
    );
  if (
    r.type === "Jinx" &&
    !/simultaneous|same time|count of three/i.test(r.instructions)
  )
    items.push(
      "Needs edit: Jinx requires simultaneous one-word answers and attempts to find a match. Review the mechanic before use.",
    );
  return items
    .map((x) => `<p class="secret"><b>Review flag</b><br>${esc(x)}</p>`)
    .join("");
};
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kindred · Question studio</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#100f16;color:#e7e1d5;font:16px/1.7 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px 22px}h1,h2{font-family:Georgia,serif;font-weight:400;line-height:1.15}h1{font-size:clamp(36px,7vw,64px);margin:14px 0}h2{font-size:30px}small,.muted{color:#b9b0c4}.gold{color:#d2b776;text-transform:uppercase;letter-spacing:2px;font-size:12px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:30px 0}.card,.panel{padding:25px;border:1px solid #75613d;border-radius:12px;background:radial-gradient(ellipse at top,#37224466,transparent),#19161f;overflow-wrap:anywhere}.panel{margin:20px 0}.badge{display:inline-block;padding:4px 10px;border:1px solid #827247;border-radius:20px;font-size:12px}.secret{padding:15px;background:#35243e;border-left:2px solid #bd9bd6;white-space:pre-wrap}.instructions{white-space:pre-wrap}summary{cursor:pointer;min-height:44px}code{overflow-wrap:anywhere;color:#d2b776}li{margin:10px 0}@media(max-width:900px){.grid{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style><main><span class="gold">✦ Kindred / private question studio</span><h1>Questions with a spark.</h1><p>Room ${esc(s.code)} · ${esc(s.name)}. Review only: nothing here is assigned to a capsule or changes the game.</p><p class="muted">${reused ? "Saved Muse results — reopening and refreshing cost no credits." : args.includes("--live") ? "One explicit batch requested: three candidates, at most one repair request." : "Template preview — no credits used."} ${esc(result.notice || "")}</p>
<details class="panel"><summary>Approved interests used (${s.players.length} players)</summary>${s.players
  .map(
    (p) =>
      `<p><b>${esc(p.name)}</b>${p.sample ? " · preview fixture, not an Instagram import" : ""}<br>${esc(
        p.interests
          .filter((i) => i.approved)
          .map((i) => i.label)
          .join(" · "),
      )}</p>`,
  )
  .join("")}</details>
<div class="grid">${result.recommendations.map((r) => `<article class="card"><span class="badge">${r.mode === "live" ? "Muse AI" : "Template fallback"}</span><p class="gold">${esc(r.type)} · ${r.duration} seconds</p><h2>${esc(r.title)}</h2>${warnings(r)}<p class="muted">${esc(r.participants.map((id) => s.players.find((p) => p.id === id)?.name || id).join(" + "))}</p><p class="instructions">${esc(r.instructions)}</p>${r.secret ? `<div class="secret"><b>Private Bounty instructions</b><br>${esc(r.secret)}</div>` : ""}<details><summary>Why this question?</summary><p>${esc(r.reason)}</p><small>Approved evidence: ${esc(s.players.flatMap((p) => p.interests.filter((i) => r.sourceInterestIds.includes(i.id)).map((i) => `${p.name}: ${i.label}`)).join("; "))}</small></details></article>`).join("")}</div>
<section class="panel"><h2>Judge the conversation.</h2><ol><li>Would you want to answer it? It should invite a story or interesting choice.</li><li>Does it use the approved interests accurately, without inventing personal facts?</li><li>Is the connection between players specific and natural?</li><li>Can everyone understand the task and finish within the timer?</li><li>Are these three options meaningfully different?</li></ol><p>Mark each 0–2. Aim for at least 8/10, with no invented personal claims. An interest reference proves grounding, not question quality; your review makes that judgment.</p><p>Saved previews: <code>npm run questions -- ${esc(s.code)}${args.includes("--sample") ? " --sample" : ""} --serve</code></p><p>Explicit new Muse batch: add <code>--live</code>. Refreshing this page never calls Muse. Local limit defaults to 100 outbound model requests across profile extraction and question generation, including repairs. This is a request cap, not a dollar balance.</p></section></main></html>`;
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
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    res.end(readFileSync(output));
  }).listen(3001, "127.0.0.1", () =>
    console.log("Private preview: http://localhost:3001 (this computer only)"),
  );
}
