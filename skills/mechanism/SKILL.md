---
name: mechanism
description: Name the mechanism when a situation feels confusing. Use to cut through a tangle to the one causal handle. Separates surface symptoms from the underlying mechanism, the constraint causing it, the feedback loop keeping it alive, and the highest-leverage intervention point — then the action that changes the mechanism rather than describing it.
---

# /ratchet:mechanism — the mechanism knife

Confusion is usually surface noise hiding a single mechanism. This command finds it. It
does not produce a taxonomy of possible causes; it names the one causal handle you can
actually pull.

## Step 0 — Load state

```
ratchet status
```

## Procedure

Given the confusing situation, separate cleanly — do not blur the layers:

1. **Surface symptoms** — what you observe. The complaints, the errors, the friction.
2. **Underlying mechanism** — the single process producing those symptoms. One precise
   model, not a list of possibilities.
3. **The constraint causing the mechanism** — the limit or rule that forces this behavior.
4. **The feedback loop keeping it alive** — why it persists instead of self-correcting.
5. **Highest-leverage intervention point** — where a small push changes the most.
6. **The action that changes the mechanism** — a move that alters the system, not one that
   merely re-describes it.

## Rules

- Use **one** precise causal model. Resist the urge to enumerate five frameworks.
- Do not over-explain. The output is a handle, not an essay.
- Make the next move obvious — a mechanism you can't act on isn't named yet.

## Output contract

```
SYMPTOMS: <what shows on the surface>
MECHANISM: <the one process underneath>
CONSTRAINT: <what forces it>
FEEDBACK LOOP: <what keeps it alive>
LEVERAGE POINT: <where to push>
CHANGING MOVE: <the action that alters the mechanism>
```

## Serialize

If the mechanism reframes the objective or reveals the true bottleneck, update state:

```
ratchet state set bottleneck "<mechanism-level blocker>"
ratchet state set phase cut
```

Next: `/ratchet:cut` to test the mechanism's assumptions, or `/ratchet:build` the changing
move directly.
