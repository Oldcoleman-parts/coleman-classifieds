---
name: next
description: Tell the user exactly what to do next and which command to run (branch, ticket state, dependencies, review status). Use when asked "what next" or "where was I".
allowed-tools: Read, Glob, Grep, Bash(node scripts/progress.mjs:*), Bash(git status:*), Bash(git branch:*), Bash(git log:*)
---

# What next

Run `node scripts/progress.mjs --summary` and `git status --short`.

| Situation                           | Tell the user                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| No ticket in progress, one is ready | `/start-feature NN` (on your working branch; a ticket branch is optional)         |
| Ticket To do                        | `/implement-ticket FNN-TN`                                                        |
| In progress                         | The missing step: plan approval, tests, try it, `/close-ticket`                   |
| Ticket Done, not committed          | `git add -A && git commit -m "feat(<module>): <title> (FNN-TN)"`, then `/compact` |
| 2 or more Done features unreviewed  | Suggest `/review-all` (optional, the user decides)                                |
| Open review findings                | `/implement-ticket FNN-FIX-N`                                                     |
| F01–F05 done                        | `/dev-store-qa e2e` and the client demo                                           |
| F01–F06 done, about to start F07-T2 | `/review-all` is **required** before launch                                       |

Reply in at most 6 lines: where you are, the exact command, what comes after, and anything ready in parallel.
