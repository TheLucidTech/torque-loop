---
name: evolve
description: "Evolve one artifact through a bounded, evidence-gated mutation loop — lock target, snapshot baseline, apply one pressure, generate candidate deltas, judge, patch, verify, keep or revert, record state, and name the next edge. Not brainstorming and not a general 'make this better': every kept change must be proven. Use to harden a specific code file, prompt, skill, test suite, README, spec, or workflow along a chosen pressure vector."
argument-hint: "<target> --goal \"<improvement>\" [--iterations 2] [--test \"<cmd>\"] [--mode code|prompt|docs|workflow|auto] [--write]"
allowed-tools:
  - Read
  - Write
  - Edit
  - MultiEdit
  - Bash
  - Grep
  - Glob
---

# Ratchet Evolve

**Mutate. Test. Keep the delta. Serialize the next edge.**

You are running a bounded artifact evolution loop. Your job is **not** to brainstorm
improvements and **not** to "make this better." Your job is to produce **evidence-gated
deltas**: one target, one pressure, small mutations, a proof gate, and a durable record.

```
LOCK → SNAPSHOT → PRESSURE → MUTATE → JUDGE → APPLY → VERIFY → KEEP/REVERT/ASK → RECORD → NEXT EDGE
```

The hard constraint, always:

```
No proof → no keep.
No keep → no progress claim.
No state → no loop continuity.
```

## Invocation

```
/ratchet:evolve <target> --goal "<improvement>" [--iterations 2] [--test "<cmd>"] [--mode code|prompt|docs|workflow|auto] [--write]
```

Parse from `$ARGUMENTS`: the target artifact, the `--goal`, `--iterations` (default **2**),
an optional `--test` command, `--mode` (default **auto**), and `--write` (default **false** —
without it, propose patches but do not modify files). If the target or goal is missing, go
straight to **ASK**.

The deterministic helpers live in the `ratchet-evolve` CLI (call via Bash; fall back to
`node "$CLAUDE_PLUGIN_ROOT/bin/ratchet-evolve"` if not on PATH).

## The loop

### 1. LOCK
State, before any edit: the exact target, the desired delta, the proof that the delta
worked, and the forbidden scope. Scope drift is the primary failure mode — name what you
will **not** touch.

### 2. SNAPSHOT
Capture the baseline. No baseline = rewriting, not evolving.
```
ratchet-evolve snapshot <target> --goal "<goal>" --mode <mode>
```
Records path, hash, git state, mode, byte/line count. Read the file for real before mutating.

### 3. PRESSURE
Choose **one primary** pressure and **at most one secondary**. Name the pressure you
**reject** and why (usually `novelty`, because it tempts a rewrite instead of a stronger
delta). `ratchet-evolve pressure <mode>` suggests a starting vector.

### 4. MUTATE
Generate **candidate deltas, not rewrites.** Each candidate: name · exact change · why it
should improve the artifact · expected measurable effect · risk · rollback cost. No mutation
may exceed the locked scope — if the best move would, stop and **ASK**.

### 5. JUDGE
Score candidates and pick exactly one. No menu ending.
```
ratchet-evolve score mutation '[{"name":"...","impact":5,"evidence":4,"reversibility":5,"goalFit":5,"risk":2,"complexity":2}, ...]'
```
Score = Impact × Evidence × Reversibility × Goal-Fit − Risk − Complexity. State the chosen
mutation and the most tempting rejected one, with the reason it lost.

### 6. APPLY
Apply the **smallest safe delta** (only if `--write`; otherwise present the patch). No
unrelated cleanup, no aesthetic rewrite. Show it as:
```
CHANGE
Before: <old section>
After:  <new section>
Reason: <one sentence>
```

### 7. VERIFY
Gather evidence — never self-grade.
```
ratchet-evolve verify <target> --test "<cmd>" --mode <mode>
```
With a test command it runs and reports pass/fail. Without one, it returns manual checks you
must actually perform. For prompts/docs, run the embarrassment harness: can a lazy model
escape the instruction? can a user misread the next action? does it still force a concrete
output, prevent self-praise, and leave durable state?

### 8. KEEP / REVERT / ASK
End every iteration in exactly one state.
- **KEEP** only if: delta matches goal · no critical regression · verification evidence
  exists · scope stayed locked.
- **REVERT** if: the mutation caused a failure · the gain is only aesthetic · the artifact
  got longer but not stronger · it introduced ambiguity. (If `--write`, actually undo it.)
- **ASK** if: target/permission/test is missing, or the next mutation touches high-risk files.

### 9. RECORD
Write the evolution event (whenever project files changed, or at each iteration):
```
ratchet-evolve log append '{"target":"...","goal":"...","iteration":1,"pressure":{"primary":"testability","secondary":"specificity"},"chosenMutation":"...","filesTouched":["..."],"verification":{"commands":[],"manualChecks":["..."],"result":"pass"},"verdict":"KEEP","remainingRisks":["..."],"nextEdge":"..."}'
```
Appends to `<project>/.ratchet/evolve-log.jsonl`.

### 10. NEXT EDGE
Name the next mutation: small, specific, testable, attached to the **same** artifact. It is
persisted with the event and readable next session via `ratchet-evolve next`. Check
`ratchet-evolve status` for the running kept/reverted/asked tally.

Copy-paste shapes live in `templates/`: `evolve-event.json` (the log-append payload),
`evolve-manual-checks.md` (manual evidence when there is no test command), and
`evolve-report.md` (the output contract below).

## Stop rules

Stop when: max iterations reached · a mutation fails and cannot be safely patched ·
verification cannot be performed · the next best move requires changing the locked target ·
improvement becomes aesthetic instead of functional · a risky write needs approval.
Defaults: `maxIterations 2 · maxFilesTouched 3 · maxMutationSize small · allowDestructiveEdits false`.

## Output contract — return exactly this

```
RATCHET EVOLVE REPORT

TARGET: <path>
GOAL: <one line>
BASELINE: <hash · mode · git state>

PRESSURE
Primary: <p>
Secondary: <p or none>
Rejected: <p> — <why>

ITERATION 1
Mutation candidates: <named list with scores>
Chosen mutation: <name> — <why it won>
Patch: <CHANGE block, or "proposed (no --write)">
Verification: <commands + result, or manual checks + result>
Verdict: KEEP | REVERT | ASK

ITERATION 2
...

FINAL STATE
Kept changes: <list or none>
Rejected changes: <list or none>
Tests/evals run: <list>
Remaining defects: <list or none>
Next edge: <the next small mutation>
State written: .ratchet/evolve-log.jsonl (<n> events)
```

Never end in "recommendations." Every run must leave behind one of: a patch, a stronger
artifact, a reverted failed mutation, a state record, or a blocking question. This is a
mutation loop with a gate — it is never a general "make this better" command.
