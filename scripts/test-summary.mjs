#!/usr/bin/env node
// Token-light test runner for Claude: `npm run test:ai [-- --changed | <paths>]`
// Prints one line when everything passes; on failure prints only test name, short reason and location.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_FAILURES = Number(process.env.TEST_AI_MAX_FAILURES || 5);
const out = path.join(os.tmpdir(), `vitest-ai-${process.pid}.json`);
const args = ["vitest", "run", "--reporter=json", `--outputFile=${out}`, "--silent", ...process.argv.slice(2)];
const started = Date.now();
const run = spawnSync("npx", args, { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0", CI: "1" } });
const secs = ((Date.now() - started) / 1000).toFixed(1);

let report;
try { report = JSON.parse(fs.readFileSync(out, "utf8")); } catch { report = null; }
try { fs.unlinkSync(out); } catch {}

if (!report) {
  // Vitest could not produce a report (no matching files, syntax or config error). Show a short tail only.
  const raw = `${run.stdout || ""}\n${run.stderr || ""}`.replace(/\u001b\[[0-9;]*m/g, "");
  if (/No test files found/.test(raw)) { console.log(`∅ no tests matched (${secs}s)`); process.exit(0); }
  const tail = raw.trim().split("\n").filter(Boolean).slice(-15).join("\n");
  console.log(`✗ test run failed before reporting (${secs}s)\n${tail}`);
  process.exit(run.status || 1);
}

const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
const total = report.numTotalTests ?? passed + failed;

if (total === 0) { console.log(`∅ no tests matched (${secs}s)`); process.exit(0); }

const head = `${failed ? "✗" : "✓"} ${passed} passed · ${failed} failed${skipped ? ` · ${skipped} skipped` : ""} · ${secs}s`;
console.log(head);

const clean = (s = "") => s.replace(/\u001b\[[0-9;]*m/g, "");
const cwd = process.cwd() + path.sep;
let shown = 0, more = 0;
for (const file of report.testResults || []) {
  const rel = (file.name || "").replace(cwd, "");
  const failures = (file.assertionResults || []).filter((a) => a.status === "failed");
  if (!failures.length && file.status === "failed" && file.message) {
    if (shown < MAX_FAILURES) { console.log(`✗ ${rel} (suite error)\n  ${clean(file.message).split("\n")[0].slice(0, 200)}`); shown++; } else more++;
    continue;
  }
  for (const a of failures) {
    if (shown >= MAX_FAILURES) { more++; continue; }
    const msg = clean((a.failureMessages || [])[0] || "");
    const reason = msg.split("\n").find((l) => l.trim()) || "failed";
    const loc = (msg.match(/\(?((?:src|app|tests?)\/[^\s():]+:\d+)/) || [])[1] || rel;
    const name = [...(a.ancestorTitles || []), a.title].join(" › ");
    console.log(`✗ ${name}\n  ${reason.trim().slice(0, 200)}   (${loc})`);
    shown++;
  }
}
if (more) console.log(`+${more} more failure(s) — run \`npm run test:ai -- <file>\` to focus`);
process.exit(failed ? 1 : 0);
