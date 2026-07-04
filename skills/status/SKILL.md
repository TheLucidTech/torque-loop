---
name: status
description: Read the current ratchet state so the loop doesn't rediscover itself. Use to orient at the start of a session or between moves. Returns the current objective, active artifact, last decision, open defects, confidence, next recommended command, and a staleness warning if work changed without a compile.
---

# /ratchet:status — read the ratchet

Orientation without re-derivation. This command reads durable state and tells you exactly
where the ratchet sits, so you resume instead of restart.

## Procedure

Lead with the **receipt** — one stable read that answers *what is true, what changed, what
is safe, what is blocked, and what happens next* without transcript archaeology:

```
ratchet receipt
```

The receipt always shows the same eight sections in the same order — **target · delta ·
proof · seam · verdict · authority · state · next** — so a cold human or agent can resume in
under a minute. Emptiness is stated, never omitted.

For the detailed state view or a specific read, add:

```
ratchet status          # the full state summary
ratchet score confidence
ratchet snapshot repo
```

## What you get

- **Current objective** — the locked target.
- **Bottleneck** — the chosen blocker.
- **Confidence** — three scoped layers (artifact · session · ledger health), so a verified
  patch is never shown as blocked because of unrelated debt.
- **Active / last artifact** — what exists now.
- **Last decision** — the most recent commitment.
- **Open defects** — unresolved failures, by severity.
- **Open loops & untested assumptions** — outstanding pressure.
- **Next action + next command** — where to go.
- **Staleness warning** — ⚠️ if work changed since the last `/ratchet:compile`.

## Output contract

Return the rendered receipt verbatim, then one line of interpretation:

```
READ: <one sentence — where the ratchet is and the single most useful next move>
```

If state is empty (no objective), say so and point to `/ratchet:lock` or `/ratchet:ignite`.
If stale, the honest next move is `/ratchet:compile` before anything else.
