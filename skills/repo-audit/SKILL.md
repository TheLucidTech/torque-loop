---
name: repo-audit
description: Discover user-facing features, workflows, routes, APIs, configs, and tests in a codebase by evidence, not guesses. Use to turn an unfamiliar or under-documented repo into an inventory of what actually ships. Returns features with code evidence, undocumented screens/routes/workflows, APIs and state transitions needing tests, the highest-risk feature, and the first test suite to write.
---

# /ratchet:repo-audit — evidence-based feature discovery

A codebase is a claim about what it does. This command verifies the claim by evidence.
It discovers user-facing features from the code itself — not from the README, not from
memory — and marks the gaps between what exists and what is tested.

## Step 0 — Load state and ground truth

```
ratchet snapshot repo
```

Then read for real: routes, entrypoints, handlers, UI components, API definitions, config,
and existing tests. Use Grep/Glob to find route tables, exported handlers, and test files.
Do not infer a feature you cannot point to in code.

## Procedure

For each user-facing feature discovered **by evidence**, capture:

- **Feature ID** and **name**
- **User story** — who does what, and why
- **Evidence in code** — file:line where it lives
- **Expected behavior** — what it should do
- **Edge cases** — the inputs that stress it
- **Test cases** — what would verify it
- **Dependencies** — what it relies on
- **Known assumptions** — what it takes for granted
- **Current risk level** — critical / high / medium / low

Then identify the gaps:

1. **Screens / routes / workflows not yet documented.**
2. **APIs or state transitions that need tests.**
3. **The highest-risk feature** — most user-facing × least tested.
4. **The first test suite to write.**
5. **The smallest fix likely to improve user trust.**

## Rules

- **Do not declare coverage complete** unless every route, screen, workflow, and API
  interaction has evidence. Missing evidence is a finding, not a rounding error.
- A feature with no test is a defect waiting to happen — record it.

## Output contract

Return the feature inventory as a table, then the five gap findings. Then serialize:

```
ratchet ledger create
ratchet ledger update features '{"name":"...","area":"...","routes":"...","status":"discovered"}'
ratchet defect add '{"severity":"high","summary":"<highest-risk feature> has no test coverage"}'
```

Next: `/ratchet:qa-ledger` to formalize the canonical ledger, then `/ratchet:verify`.
