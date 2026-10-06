---
name: security-review
description: On-demand security audit of a chosen scope using the module security skills (default: everything since the last review checkpoint). Use as "/security-review", "/security-review F06" or "/security-review payments".
argument-hint: "[optional: feature numbers, module names, or 'since <git ref>']"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*), Bash(git tag:*)
---

# Security review: $ARGUMENTS

1. **Scope:** as in `/code-review`. Map each file in scope to its module and its `security-<module>` skill (`app/modules/<m>/CLAUDE.md` names it).
2. For each module in scope, delegate to `security-auditor` with that module’s skill. Run them in parallel when there are several.
3. Check that each module’s “Required security tests” exist.
4. Merge the findings into **Critical / High / Medium / Low**, with the module, file, line and fix. Write the report, or return the findings when called from `/review-all`.
