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

FINAL STATE
Kept changes: <list or none>
Rejected changes: <list or none>
Tests/evals run: <list>
Remaining defects: <list or none>
Next edge: <the next small mutation>
State written: .ratchet/evolve-log.jsonl (<n> events)
