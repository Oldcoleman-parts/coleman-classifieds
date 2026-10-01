#!/usr/bin/env node
// Progress + review status from docs/features/*/tickets/*.md and docs/reviews/review-log.json
// Usage: node scripts/progress.mjs [--summary | --statusline | --feature NN | --json]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const featDir = path.join(root, "docs", "features");
const [mode = "--summary", arg] = process.argv.slice(2);
const field = (txt, name) => (txt.match(new RegExp(`\\*\\*${name}\\*\\*\\s*\\|\\s*(.+?)\\s*\\|`)) || [])[1];

const feats = !fs.existsSync(featDir) ? [] : fs.readdirSync(featDir).filter((d) => /^\d\d-/.test(d)).sort().map((d) => {
  const readme = fs.readFileSync(path.join(featDir, d, "README.md"), "utf8");
  const tdir = path.join(featDir, d, "tickets");
  const tickets = (fs.existsSync(tdir) ? fs.readdirSync(tdir) : []).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const t = fs.readFileSync(path.join(tdir, f), "utf8");
    const boxes = [...t.matchAll(/^- \[( |x)\]/gm)];
    return {
      id: f.replace(/\.md$/, ""),
      name: (t.match(/^# \S+ — (.+?)\s*$/m) || [])[1] || f,
      status: field(t, "Status") || "To do",
      fix: /-FIX-/.test(f),
      done: boxes.filter((b) => b[1] === "x").length,
      total: boxes.length,
    };
  });
  return {
    num: d.slice(0, 2),
    title: (readme.match(/^# F\d\d — (.+?)\s*$/m) || [])[1] || d,
    phase: field(readme, "Phase") || "?",
    deps: field(readme, "Depends on") || "—",
    tickets,
  };
});

const byNum = Object.fromEntries(feats.map((f) => [f.num, f]));
const base = (f) => f.tickets.filter((t) => !t.fix);
const isDone = (f) => base(f).length > 0 && base(f).every((t) => t.status === "Done");
const started = (f) => f.tickets.some((t) => t.status !== "To do");
const depNums = (deps) => deps.split(",").flatMap((p) => {
  const m = p.trim().match(/^F?(\d\d)(?:\s*[–-]\s*F?(\d\d))?$/);
  if (!m) return [];
  const a = +m[1], b = m[2] ? +m[2] : a;
  return Array.from({ length: b - a + 1 }, (_, i) => String(a + i).padStart(2, "0"));
});
const ready = (f) => depNums(f.deps).every((n) => byNum[n] && isDone(byNum[n]));

// review status
let log = { reviews: [] };
try { log = JSON.parse(fs.readFileSync(path.join(root, "docs/reviews/review-log.json"), "utf8")); } catch {}
const reviewed = new Set(log.reviews.filter((r) => r.code && r.security).flatMap((r) => (r.features || []).map((x) => String(x).replace(/^F/, "").padStart(2, "0"))));
const openFix = feats.flatMap((f) => f.tickets.filter((t) => t.fix && t.status !== "Done").map((t) => t.id));
const unreviewed = feats.filter((f) => started(f) && !reviewed.has(f.num)).map((f) => `F${f.num}`);
const lastReview = log.reviews.at(-1);

let branch = "";
try { branch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
const bm = branch.match(/f(\d\d)-(t\d+|fix-\d+)/i);
const currentId = bm ? `F${bm[1]}-${bm[2].toUpperCase()}` : null;
const all = feats.flatMap((f) => f.tickets.map((t) => ({ ...t, f })));
const launch = all.filter((t) => t.f.phase === "1" && !t.fix);
const launchDone = launch.filter((t) => t.status === "Done").length;
const next = feats.filter((f) => f.phase === "1" && !isDone(f) && ready(f))
  .map((f) => base(f).find((t) => t.status !== "Done")).filter(Boolean).map((t) => t.id);

if (mode === "--json") { console.log(JSON.stringify({ feats, next, currentId, unreviewed, openFix, lastReview }, null, 2)); process.exit(0); }

if (mode === "--statusline") {
  const cur = currentId && all.find((t) => t.id === currentId);
  const curTxt = cur ? `${cur.id} ${cur.status} ${cur.done}/${cur.total}` : next[0] ? `next: ${next[0]}` : "launch work done";
  const rev = openFix.length ? ` ▸ fixes open: ${openFix.length}` : unreviewed.length ? ` ▸ unreviewed: ${unreviewed.join(",")}` : "";
  console.log(`CC ▸ launch ${launchDone}/${launch.length}${rev} ▸ ${curTxt}`);
  process.exit(0);
}

if (mode === "--feature") {
  const f = byNum[String(arg || "").replace(/^F/i, "").padStart(2, "0")];
  if (!f) { console.log(`Unknown feature ${arg}`); process.exit(1); }
  console.log(`F${f.num} ${f.title} · phase ${f.phase} · depends on ${f.deps} · ${isDone(f) ? "DONE" : ready(f) ? "READY" : "BLOCKED"} · ${reviewed.has(f.num) ? "reviewed" : "not reviewed"}`);
  for (const t of f.tickets) console.log(`  ${t.status.padEnd(11)} ${t.id.padEnd(11)} ${t.name}  [${t.done}/${t.total}]`);
  process.exit(0);
}

console.log(`Coleman Classifieds — launch ${launchDone}/${launch.length} tickets`);
for (const f of feats) {
  const d = base(f).filter((t) => t.status === "Done").length;
  const state = isDone(f) ? "DONE   " : ready(f) ? "READY  " : "BLOCKED";
  const rv = reviewed.has(f.num) ? "reviewed" : started(f) ? "UNREVIEWED" : "";
  const fx = f.tickets.filter((t) => t.fix && t.status !== "Done").length;
  console.log(`  F${f.num} ${state} ${d}/${base(f).length}  ${f.title}${f.phase !== "1" ? ` (phase ${f.phase})` : ""}${rv ? `  · ${rv}` : ""}${fx ? `  · ${fx} fix open` : ""}`);
}
if (currentId) console.log(`Current: ${currentId}`);
console.log(`Ready: ${next.join(", ") || "none"}`);
console.log(`Reviews: ${lastReview ? `last ${lastReview.id} on ${lastReview.date}` : "none yet"}${unreviewed.length ? ` · unreviewed: ${unreviewed.join(", ")} (run /review-all when you choose)` : ""}`);
