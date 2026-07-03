---
name: prompt-audit
description: Audit a prompt library as an operating system, not a pile of prompts. Use to find what a prompt collection over-does, under-does, and where it leaks into meta-looping. Classifies each prompt by the work it performs, finds overrepresented and missing moves, flags prompts that cause meta-loops or never produce artifacts, and returns the minimum upgraded set as a sequenced workflow.
---

# /ratchet:prompt-audit — the library as an OS

A prompt library is not a pile of good words; it is an operating system for cognition.
This command audits it as one. It does not rewrite prompts first — it diagnoses the system:
what work each prompt does, which moves are missing, and where the library lets the model
escape into elegant analysis instead of producing something.

## Step 0 — Load the library

Take the prompt list from the argument, a file, or the current context. Do not rewrite yet.

## Classify

Tag each prompt by the **type of work** it performs (a prompt may do more than one):

- target locking · diagnosis · artifact production · adversarial testing · decision ·
  patching · memory/state · orchestration · compression · boundary pushing

## Find the system's shape

1. **Overrepresented moves** — where the library is thick (usually diagnosis and "next
   move" prompts).
2. **Missing moves** — where it is thin (usually artifact production, patching, testing,
   serialized state).
3. **Meta-looping prompts** — those that ask what to ask next without ever forcing a move.
   These are the hallway of mirrors.
4. **Artifact-producing prompts** — the ones that actually leave something behind.
5. **Prompts to delete or merge** — redundant, vague, or low-consequence.
6. **The minimum new prompt set** that would outperform the current library.

## The operating rule

Judge every prompt against this bar. Keep it only if it does at least one:

1. Forces a choice. 2. Creates an artifact. 3. Tests an artifact. 4. Patches a defect.
5. Serializes useful state. 6. Kills a bad option. 7. Pushes to a higher-yield move.

Everything else is smoke.

## Output contract

```
CLASSIFICATION: <table: prompt → work type(s)>
OVERREPRESENTED: <moves the library over-does>
MISSING: <moves it lacks — the expensive gaps>
META-LOOPERS: <prompts that never force a move>
DELETE / MERGE: <the cuts>
UPGRADED SET (sequenced workflow, not a pile):
1. <prompt> — <the move it forces>
2. ...
```

## Serialize

```
ratchet artifact add '{"title":"prompt-library audit","kind":"decision-record","status":"v0","holes":["..."]}'
```

Produce the upgraded library as a **sequenced workflow** — frame → choose → build → attack
→ patch → serialize → advance — never a flat list. Next: `/ratchet:build` the new set.
