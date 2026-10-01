---
name: code-review
description: On-demand code review of a chosen scope (default: everything since the last review checkpoint). Use as "/code-review", "/code-review F03 F04" or "/code-review since main~20".
argument-hint: "[optional: feature numbers like F03 F04, or 'since <git ref>']"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*), Bash(git tag:*), Bash(node scripts/progress.mjs:*), Bash(npm run test:ai:*)
---

# Code review: $ARGUMENTS

1. **Scope:**
   - features given → their module folders (from `AGENTS.md`);
   - `since <ref>` → `git diff <ref>...HEAD`;
   - nothing given → `git diff <last review-N tag>...HEAD` (if there’s no tag yet, everything).
     List the files and features in scope and confirm with the user if there are more than 60 files.
2. Run `npm run test:ai` once (the full suite) and record the one-line result.
3. Delegate to `code-reviewer` with the scope. For large scopes, run one reviewer per feature in parallel.
4. Merge the findings into **Critical / High / Medium / Low** and write them to the report (see `/review-all` for the format). If this is called as part of `/review-all`, return the findings instead of writing a report.
