---
name: status
description: Read the current ratchet state so the loop doesn't rediscover itself. Use to orient at the start of a session or between moves. Returns the current objective, active artifact, last decision, open defects, confidence, next recommended command, and a staleness warning if work changed without a compile.
---

# /ratchet:status — read the ratchet

Orientation without re-derivation. This command reads durable state and tells you exactly
where the ratchet sits, so you resume instead of restart.

## Procedure

Read the serialized state and render it:

```
ratchet status
```

Add the confidence read and repo ground-truth when useful:

```
ratchet score confidence
ratchet snapshot repo
```

## What you get

- **Current objective** — the locked target.
- **Bottleneck** — the chosen blocker.
- **Confidence** — score/100 + band, and whether the loop is clear to stop.
- **Active / last artifact** — what exists now.
- **Last decision** — the most recent commitment.
- **Open defects** — unresolved failures, by severity.
- **Open loops & untested assumptions** — outstanding pressure.
- **Next action + next command** — where to go.
- **Staleness warning** — ⚠️ if work changed since the last `/ratchet:compile`.

## Output contract

Return the rendered state verbatim, then one line of interpretation:

```
READ: <one sentence — where the ratchet is and the single most useful next move>
```

If state is empty (no objective), say so and point to `/ratchet:lock` or `/ratchet:ignite`.
If stale, the honest next move is `/ratchet:compile` before anything else.
