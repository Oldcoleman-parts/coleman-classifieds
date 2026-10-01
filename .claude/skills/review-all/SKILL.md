---
name: review-all
description: On-demand combined code review + security audit with a saved report, fix tickets and a new review checkpoint. Default scope is everything since the last checkpoint. Use as "/review-all" or "/review-all F03 F04 F05".
argument-hint: "[optional: feature numbers or 'since <git ref>']"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash(git diff:*), Bash(git log:*), Bash(git tag:*), Bash(git rev-parse:*), Bash(node scripts/progress.mjs:*), Bash(npm run test:ai:*)
---

# Review all: $ARGUMENTS

1. **Scope:** features given, or `since <ref>`, or (by default) everything since the last `review-N` tag. Show the list of features and files in scope.
2. Run `/code-review` and `/security-review` on the same scope (each returns its findings), plus one full `npm run test:ai`.
3. **Report:** write `docs/reviews/<YYYY-MM-DD>-review-<N>.md` containing:
   - the scope (features, commit range);
   - the test result line;
   - a summary count per severity;
   - findings grouped by feature, each as `[SEV] module · file:line, problem → fix`.
4. **Fix tickets:** for every Critical and High finding, create `docs/features/<NN>-*/tickets/F<NN>-FIX-<n>.md` (Status To do, Scope = the fixes, Acceptance = the fixed behaviour + test). Add them to the feature README table using the `docs-keeper` agent. Medium and Low findings stay in the report as a checklist.
5. **Checkpoint:** ask the user to confirm. Then append to `docs/reviews/review-log.json`: `{ id, date, commit (git rev-parse HEAD), features, code: true, security: true, openCriticalHigh }`. Suggest `git tag review-<N>` (the user runs it).
6. Close with the counts per severity, the fix tickets created, and the next command.

**Launch gate:** F07-T2 checks that every launch feature appears in the log, with `openCriticalHigh` = 0 after the fix tickets are Done (set it to 0 by re-running `/review-all` on the fixes).
