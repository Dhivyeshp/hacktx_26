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
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Destina questions</title><style>
@import url("https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,500;1,400&family=Karla:wght@400;500;600&display=swap");
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#252823;color:#eeeadf;font:16px/1.75 "Karla",sans-serif}main{max-width:1180px;margin:auto;padding:48px 36px}h1,h2{font-family:"Bodoni Moda",Georgia,serif;font-weight:400;line-height:1.15;text-wrap:balance}h1{font-size:clamp(42px,6vw,70px);margin:24px 0}h2{font-size:34px;margin:0 0 18px}small,.muted{color:#b8bbae}.gold{color:#cdb68a;text-transform:uppercase;letter-spacing:1.6px;font-size:11px}.grid{margin:40px 0;background:#eeeadf;color:#2d3228;padding:0 34px}.card{padding:34px 0;border-bottom:1px solid #b2b7a3;display:grid;grid-template-columns:140px minmax(0,1fr);gap:32px;overflow-wrap:anywhere}.card:last-child{border:0}.card .muted{color:#626b58;font-size:14px}.card p{margin:16px 0}.card .gold{color:#697356;font-size:10px}.question-number{font:52px "Bodoni Moda",Georgia,serif;color:#818b70;display:block;margin-bottom:18px}.question-meta{font-size:12px;line-height:1.9;color:#697356}.question-meta span{display:block}.instructions{font-size:18px;line-height:1.8;white-space:pre-wrap}.secret{border-left:2px solid #a77343;padding:12px 18px;background:none;white-space:pre-wrap;font-size:14px}.panel{margin:28px 0;padding:24px 0;border-top:1px solid #59604f}.panel h2{font-size:30px}.panel p{max-width:760px}details{font-size:14px}summary{cursor:pointer;min-height:48px;padding:12px 0;border-top:1px solid #a2aa93}summary:focus-visible{outline:2px solid #a77343;outline-offset:3px}code{overflow-wrap:anywhere;color:#d3bd91;font-size:12px}.card small{color:#657153}.wordmark{font:28px "Bodoni Moda",Georgia,serif;letter-spacing:4px;border-bottom:1px solid #59604f;padding-bottom:22px;display:flex;align-items:center;justify-content:space-between}.wordmark small{font:10px "Karla",sans-serif;letter-spacing:1px}.panel .gold{margin-top:20px}@media(max-width:700px){main{padding:30px 22px}.grid{padding:0 22px;margin:30px 0}.card{grid-template-columns:1fr;gap:18px;padding:26px 0}.question-aside{display:flex;gap:22px;align-items:center}.question-number{font-size:38px;margin:0}.question-meta{display:flex;gap:14px;font-size:11px}.instructions{font-size:16px}h2{font-size:29px}.wordmark{font-size:24px}.wordmark small{font-size:8px}.panel{margin:24px 0}}
</style><main><div class="wordmark">DESTINA<small>AT THE TABLE WITH TINA</small></div><h1>Questions for the table.</h1><p>Room ${esc(s.code)}, ${esc(s.name)}. These questions are here for review. None have been assigned to a relic.</p><p class="muted">${reused ? "These Muse questions are saved. Refreshing costs no credits." : args.includes("--live") ? "One batch of three questions was requested. It allows at most one repair." : "These are template questions. No credits were used."} ${esc(result.notice || "")}</p>
<details class="panel"><summary>Approved interests used (${s.players.length} players)</summary>${s.players
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
<div class="grid">${result.recommendations.map((r, index) => `<article class="card"><aside class="question-aside"><span class="question-number">${String(index + 1).padStart(2, "0")}</span><div class="question-meta"><span>${esc(r.type)}</span><span>${r.duration} seconds</span><span>${r.mode === "live" ? "From Muse" : "From the library"}</span></div></aside><div class="question-body"><h2>${prose(r.title)}</h2><p class="muted">${esc(r.participants.map((id) => s.players.find((p) => p.id === id)?.name || id).join(" and "))}</p><p class="instructions">${prose(r.instructions)}</p>${r.secret ? `<div class="secret"><b>The private mission</b><p>${prose(r.secret)}</p></div>` : ""}${warnings(r)}<details><summary>Why this question?</summary><p>${prose(r.reason)}</p><small>Based on ${esc(s.players.flatMap((p) => p.interests.filter((i) => r.sourceInterestIds.includes(i.id)).map((i) => `${p.name} chose ${i.label}`)).join("; "))}</small></details></div></article>`).join("")}</div>
<section class="panel"><h2>How do these feel?</h2><p>Would you want to answer these? A good question gives you something specific to talk about without assuming things about your life.</p><p>The rules should be clear, the task should fit the timer, and each option should feel different. A reference to an interest alone doesn’t make a question good.</p><p>Anything that invents a personal fact or confuses the game rules needs an edit before play.</p><p>The saved preview is available with <code>npm run questions -- ${esc(s.code)}${args.includes("--sample") ? " --sample" : ""} --serve</code></p><p>For a new Muse batch, add <code>--live</code>. Refreshing this page never calls Muse. Local limit defaults to 100 outbound model requests across profile extraction and question generation, including repairs. This is a request cap, not a dollar balance.</p></section></main></html>`;
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
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'",
    );
    res.end(readFileSync(output));
  }).listen(3001, "127.0.0.1", () =>
    console.log("Private preview: http://localhost:3001 (this computer only)"),
  );
}
