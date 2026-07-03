---
name: auction
description: Rank the real blockers by leverage and pick the one bottleneck to attack. Use when there are many possible next moves and you risk doing interesting-but-not-advancing work. Scores obstacles by Leverage × Certainty × Speed-to-unblock × Risk-of-ignoring and names the winner and why it beats the tempting alternative.
---

# /ratchet:auction — friction auction

Not all obstacles deserve your attention. This command runs a sealed auction where
blockers bid for your effort, and the highest-leverage one wins. It exists to stop you
from doing work that is interesting but does not advance the target.

## Step 0 — Load state

```
ratchet status
```

## Procedure

1. **Enumerate the real blockers** between the current state and the locked target's
   proof-of-done. Real means: if unsolved, the target does not ship. Exclude anything
   that is merely uncomfortable or merely interesting.

2. **Score each blocker** on four 1–10 axes:
   - **Leverage** — how much unblocking it frees downstream (10 = unblocks everything).
   - **Certainty** — how sure you are it is actually the blocker (10 = proven).
   - **Time-to-unblock** — how fast it can be cleared (10 = fast, 1 = slow grind).
   - **Risk** — cost of ignoring it (10 = the whole thing fails if left).

3. **Compute priority** with the CLI so the math is reproducible:

   ```
   ratchet score friction '[{"name":"...","leverage":9,"certainty":8,"speed":6,"risk":9}, ...]'
   ```

   Priority = Leverage × Certainty × Time-to-unblock × Risk. Highest priority wins.

4. **Defend the winner.** State why it beats the most tempting alternative — usually the
   one that is more fun, more visible, or already familiar.

5. **Name the artifact** that removes the winning bottleneck. That artifact is the target
   of the next `/ratchet:build`.

## Output contract

```
FRICTION TABLE: <the ranked table from the CLI>
WINNING BOTTLENECK: <name + priority>
BEATS: <tempting alternative> because <load-bearing reason>
REQUIRED ARTIFACT: <what to build to clear it>
```

## Serialize

```
ratchet state set bottleneck "<winning blocker>"
ratchet state set phase auction
```

Next: `/ratchet:cut` to make sure the bottleneck is real before you spend on it, then
`/ratchet:build`.
