#!/usr/bin/env node
// PostToolUse hook: formats the edited file with Prettier (no jq needed).
import { execFileSync } from "node:child_process";
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const file = JSON.parse(input)?.tool_input?.file_path;
    if (file && /\.(ts|tsx|js|jsx|json|css|md)$/.test(file)) {
      execFileSync("npx", ["prettier", "--write", "--log-level", "warn", file], {
        stdio: "ignore",
      });
    }
  } catch {
    /* never block Claude on formatting */
  }
});
