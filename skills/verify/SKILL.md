---
name: verify
description: Run a change (or an artifact) through a test harness built to embarrass it, then record the results as defects. Use instead of asking whether the work is good — never self-grade. Builds acceptance / happy-path / edge / abuse / ambiguity / regression tests plus fake-progress red flags, runs the artifact through them, and returns passes, failures, severity, required patches, and whether it is usable despite failures.
---

# /ratchet:verify — the embarrassment harness

Do not grade the artifact. Asking a model "how good is this?" gets you self-praise. This
command instead builds a harness designed to *embarrass* the artifact, then runs it
through. Validation, not vibes.

## Step 0 — Load state and target

```
ratchet status
ratchet snapshot repo
```

Identify the change or artifact under test (usually the last artifact, or the current diff).

## Build the harness

Construct all seven, then run the artifact against them:

1. **Acceptance criteria** — the conditions that define "correct".
2. **Happy-path test** — the intended use, working.
3. **Edge-case tests** — boundaries: empty, huge, zero, negative, unicode, concurrent.
4. **Abuse / misuse tests** — hostile or wrong input a real user will eventually send.
5. **Ambiguity tests** — under-specified inputs where behavior is undefined.
6. **Regression tests** — what previously worked and must still work.
7. **Fake-progress red flags** — the tells that this is theater: passes only on the
   author's example, swallows errors, asserts nothing, tests the mock not the code.

**Run the artifact through the harness for real.** Where a runtime exists, execute it via
Bash — do not simulate a pass in your head. Report the actual result.

## Output contract

```
HARNESS: <the tests, briefly>
RESULTS:
- PASS: <checks that held>
- FAIL: <check> — <what happened> — severity: critical/high/medium/low
RED FLAGS: <any fake-progress tells found, or "none">
USABLE DESPITE FAILURES? <yes/no + one-line reason>
REQUIRED PATCHES: <smallest delta per failure>
```

## Serialize

Record every failure as a defect and update the ledger:

```
ratchet defect add '{"severity":"...","summary":"verify: <failure>","feature":"<ledger feature id>"}'
ratchet ledger update tests '{"feature":"<id>","name":"<test>","status":"fail"}'
ratchet score confidence
```

Next: `/ratchet:patch` the failures, then re-run `/ratchet:verify` on the patched artifact.
A change isn't done because it typechecks — it's done because the harness couldn't embarrass it.
