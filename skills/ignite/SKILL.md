---
name: ignite
description: Run the full consequence loop on any messy task, project state, prompt pile, codebase goal, or vague direction. Use this when you do not know which Ratchet command to use. Locks a target, ranks blockers, cuts assumptions, builds the smallest artifact, attacks it, patches failures, and serializes state — ending with the single next move.
---

# /ratchet:ignite — the master loop

**Ambiguity in. Artifact out. Failure tested. State advanced.**

This is the command you run when you don't know which command to run. It drives one
full turn of the ratchet: from vague input to a tested artifact and a serialized next
move. Do not stop at analysis. The turn is not complete until an artifact exists and
state is written.

## Step 0 — Load state

Run this first (via Bash) so you build on the existing session, not a blank one:

```
ratchet init
ratchet status
ratchet snapshot repo
```

If `ratchet` is not on PATH, call it as `node "$CLAUDE_PLUGIN_ROOT/bin/ratchet"`.

## The pipeline (run all seven; do not skip)

1. **Lock the target.** Apply the discipline of `/ratchet:lock`. Produce: literal
   object, operation, output shape, real outcome, proof-of-done, smallest artifact,
   highest-information missing variable, and the assumption you'll adopt if it's missing.
   Persist: `ratchet state set objective "<one line>"`.

2. **Run the friction auction.** Apply `/ratchet:auction`. List the real blockers, score
   each, and pick the one bottleneck with the highest leverage. Feed candidates to
   `ratchet score friction '[...]'` and adopt its winner. Persist:
   `ratchet state set bottleneck "<winner>"`.

3. **Cut assumptions.** Apply `/ratchet:cut`. Name the assumptions that would make this
   plan look stupid in hindsight, and the cheapest test to falsify each. Persist the
   riskiest via `ratchet state append assumptions '{"text":"...","killTest":"...","status":"untested"}'`.

4. **Build the smallest usable artifact.** Apply `/ratchet:build`. Produce a real v0 —
   spec, prompt, checklist, patch, test plan, or decision record — with explicit holes
   and a 5-point working test. Persist: `ratchet artifact add '{"title":"...","kind":"...","status":"v0","holes":["..."]}'`.
   Delegate to the `ratchet-builder` subagent if the artifact is large.

5. **Attack the artifact.** Apply `/ratchet:attack`. Run the five-voice hostile board.
   Record each real defect: `ratchet defect add '{"severity":"...","summary":"..."}'`.
   Delegate to the `ratchet-auditor` subagent for anything that looks finished.

6. **Patch what failed.** Apply `/ratchet:patch`. Fix only the defects found — REMOVE /
   ADD / CHANGE — and retest. Do not rewrite for elegance.

7. **Compile state.** Apply `/ratchet:compile`. Write decisions, artifacts, defects, open
   loops, and the single next action + next command. Run `ratchet state set nextAction "..."`
   and `ratchet state set nextCommand "/ratchet:..."`, then `ratchet export markdown`.

## Output contract

Return exactly these blocks, in order:

```
LOCKED TARGET: <one line>
CHOSEN BOTTLENECK: <one line + why it beats the runner-up>
KILL-ASSUMPTION: <the one that most needs a test> — test: <cheapest falsification>
ARTIFACT: <title (kind, v0)> — then the artifact itself
ATTACK: <n critical / n high> — top failure mode
PATCH: <the minimal delta applied> — retest result
REMAINING RISK: <what is still open>
NEXT: <single action> → <next /ratchet command>
CONFIDENCE: <run `ratchet score confidence` and report score/band>
```

Then confirm state was written: `ratchet status`.

The ratchet only turns one way. End every ignite with more committed than you started.
