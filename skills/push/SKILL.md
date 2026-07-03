---
name: push
description: Push the boundary after a safe version already exists. Use to find the boldest adjacent move that could multiply the result without turning it into fantasy. Returns the safe default, the boundary-pushing path, why it might work, why it might be stupid, the cheapest experiment that distinguishes them, the version to try, and the first irreversible move. Controlled aggression, never recklessness.
---

# /ratchet:push — the boundary push

Once the safe version exists, the question changes from "does it work?" to "how much more
is on the table?" This command finds the edge where information gain is highest — the bold
adjacent move that could multiply the result — without tipping into fantasy.

## Step 0 — Load state

```
ratchet status
```

Only run this **after** a safe, tested artifact exists. Pushing an unbuilt idea is not
aggression; it is avoidance.

## Procedure

Given the current artifact or plan, return:

1. **Safe default path** — the conservative version you already have or would ship.
2. **Boundary-pushing path** — the boldest adjacent move that could multiply the result.
3. **Why it might work** — the mechanism that would make the upside real.
4. **Why it might be stupid** — the honest failure case; the way it turns into fantasy.
5. **Cheapest distinguishing experiment** — the smallest test that tells you which path is
   real before you commit to either.
6. **The version to try** — your pick, stated.
7. **First irreversible move** — the action that commits you and can't be trivially undone.

## Rules

- **Not reckless, not timid.** Reckless ignores the failure case; timid never leaves the
  safe path. Aim for the edge where information gain per unit of risk is highest.
- The boundary path must have a real mechanism, not just ambition. If you can't say why it
  would work, it's fantasy — mark it so.

## Output contract

```
SAFE DEFAULT: <path>
BOUNDARY PATH: <bold adjacent move>
WHY IT WORKS: <mechanism>
WHY IT'S STUPID: <honest failure case>
DISTINGUISHING EXPERIMENT: <cheapest test>
VERSION TO TRY: <pick>
FIRST IRREVERSIBLE MOVE: <the committing action>
```

## Serialize

Record the push as a decision with a built-in reversal tripwire:

```
ratchet state append decisions '{"choice":"push: <boundary path>","rejected":"safe default","tripwire":"<signal the experiment fails>"}'
ratchet state set phase decide
```

Next: `/ratchet:build` the distinguishing experiment first. The experiment is cheaper than
the commitment — run it before the irreversible move.
