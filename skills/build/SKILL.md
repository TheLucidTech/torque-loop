---
name: build
description: Force artifact production — stop talking and make the thing. Use when a target is locked and something concrete must exist. Produces the smallest usable v0 (spec, prompt, checklist, test-suite, decision-record, code-patch, qa-ledger, or operating-procedure) with explicit holes and a 5-point working test.
argument-hint: "[spec|prompt|checklist|test-suite|decision-record|code-patch|qa-ledger|operating-procedure]"
---

# /ratchet:build — make the thing

Analysis is not progress. This command exists to end deliberation and produce an
artifact. The output is never a description of what you would build — it is the build.

## Step 0 — Load state

```
ratchet status
ratchet snapshot repo
```

## Artifact kind

Take the kind from the argument if given, else infer it from the objective:

`spec` · `prompt` · `checklist` · `test-suite` · `decision-record` · `code-patch` ·
`qa-ledger` · `operating-procedure`

Templates for records live in the plugin's `templates/` directory — mirror their shape.

## Procedure

1. **Build the smallest usable v0.** The minimum a real user could use today. Cut every
   part that is not load-bearing for the locked proof-of-done. No gold-plating, no
   speculative generality.

2. **When editing a repo, match the neighbors.** Read adjacent files first; mirror their
   idiom, naming, and comment density. New style is a defect.

3. **State the holes.** List every gap, shortcut, and unverified claim explicitly. A named
   hole is honesty; a hidden one is a defect the auditor will find.

4. **Write a 5-point working test.** Concrete pass/fail checks a stranger could run. If you
   cannot write the test, you do not yet understand the artifact — say so and narrow scope.

**Build against the map.** If `/ratchet:map` left an `unknown-map` artifact
(`.ratchet/unknowns-map.md`), build against it — and when the code contradicts what the map
assumed, do not silently absorb it. Record a deviation (`templates/deviation-note.md`) as a
`decision`, `openLoop`, or `defect`, and add it to the map's *Deviations during build*
section. The map is a living record through the build, not a pre-build formality.

**Re-score on surprise.** Two deviations — or one that reshapes the locked target — mean
the aperture was scored too low. Re-run `ratchet score aperture`; if it now says
`Pre-build map: required`, stop building and run `/ratchet:map`. Patching deeper into
unmapped terrain is the confident-build-into-fog the dial exists to refuse.

**Build-for-learn (probe mode).** If the active task is a probe (a live `kind:"probe"`
artifact — see `templates/probe-card.md`), you are building to learn, not to keep:

- Build only the smallest artifact that produces the card's proof-of-learning; stay
  inside its allowed surfaces; stop at its stop condition.
- The probe's completion is a map/state delta — a decision, assumption, open loop, or
  defect — never a code diff. Probe code existing is not implementation progress; do not
  claim it as such.
- Then dispose: revert the code and `ratchet retract <probe-id> --reason "disposed: …"`.
  Keeping probe code is a **promotion** — a fresh build-for-keep under the full proof/seam
  gates, never a default. Undisposed probes drain confidence and flag the cold-start scan.

For large or code-heavy artifacts, delegate to the `ratchet-builder` subagent.

## Output contract

```
ARTIFACT: <title> (<kind>, v0)
<the artifact itself — inline, or a file path you wrote>
EXPLICIT HOLES:
- ...
5-POINT WORKING TEST:
1. ...
2. ...
3. ...
4. ...
5. ...
```

## Serialize

```
ratchet artifact add '{"title":"<title>","kind":"<kind>","status":"v0","path":"<path or empty>","holes":["...","..."]}'
ratchet state append openLoops '{"text":"deviation: map said X, code revealed Y — needs user judgment","status":"open"}'   # only if the build diverged from the map
ratchet state set phase build
```

Do not declare it done. The next move is `/ratchet:attack` — an unattacked artifact is a
guess, not a deliverable.
