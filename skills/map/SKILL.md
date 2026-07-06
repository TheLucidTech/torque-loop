---
name: map
description: Map the fog before you build. Use when uncertainty is high (aperture A3–A4), the terrain is unfamiliar, the taste is "I'll know it when I see it", or you are porting a reference implementation. Walks the task through four unknown-quadrants — known knowns (settled ground with file evidence), known unknowns (one blast-radius-ordered question at a time), unknown knowns (tacit taste surfaced by handing over something concrete to react to), and unknown unknowns (a swept landmine field) — then hands over one durable four-quadrant map, a tweakable build plan, and a copy-paste implementation prompt. The map, not code, is the deliverable; you do not build until it is handed over.
---

# /ratchet:map — the fog-of-war gate

When uncertainty is high, the expensive mistake is a confident build in the wrong
direction. `/ratchet:lock` says: infer the missing value, name the assumption, move.
That is correct for low-uncertainty work. This command is its counterweight for the
high-uncertainty case — it maps the terrain *before* the build so you never spend three
PRs discovering what one code read would have shown. **The map, not code, is the
deliverable.** You do not build until it is handed over.

Two moves make the walk work:

- **Reacting beats imagining.** Never ask the user to describe intent from a blank page.
  Hand over something concrete — a sample, a mock, competing design directions — and let
  them react. Recognition is cheap; invention is expensive.
- **Every artifact assembles the reply.** End each turn with lettered options the user can
  answer in a few characters, so they react instead of composing.

## Step 0 — Load state, then scan the terrain

```
ratchet status
ratchet snapshot repo
```

Scan first. Gather what already exists, what is half-built, and what was tried and
reverted — *before* you open your mouth. Serial questions on unread terrain waste the
user's attention.

## Procedure

Walk the four quadrants **in order**, naming the current one. Disclose material findings
the moment you hit them; never close a quadrant off-screen.

1. **Known knowns — settle the ground.** State the facts, each cited to `file:line`.
   Mark every assumption *separately* and flag it "settled unless you say otherwise", so
   a wrong premise gets corrected now instead of after the build.

2. **Known unknowns — one question at a time.** Ask the single highest-blast-radius
   question first (the answer that reshapes the most), not a wall of them. Give lettered
   options with a **recommended** answer. Close each question exactly one way, in front of
   the user: **user answer**, **territory** (you researched it, then show question +
   finding), or **OPEN** (deferred, with what would unblock it).

3. **Unknown knowns — extract the tacit.** The user cannot articulate what they don't know
   they know. Do not ask abstractly. Hand over something concrete to react to — sample
   data, a throwaway mock, three or four incompatible renderings of the same thing — and
   let the reaction reveal the taste. Probe the offhand context: who consumes this, where
   it runs, what "done" looks like to whoever inherits it. Record what each reaction changes.

4. **Unknown unknowns — sweep for landmines.** Hunt the silent failure modes a shallow
   read misses: wrong-by-default data, stale denormalizations, **unwritten conventions**
   the code enforces but no doc records, **half-built or reverted prior attempts (and why
   they died — the reason is usually the landmine)**, and latent bugs this path inherits.
   Worst first. Each as a card:

   ```
   evidence: <file:line>   why it bites: <mechanism>   what it changes: <task impact>
   status: decided | OPEN | sharp-edge
   ```

5. **Hand over the map.** One page, all four quadrants. OPEN items live **on the map**, not
   buried in chat. Add a tweakable build plan ordered by *what might change* (judgment calls
   first, routine work compressed at the bottom) and a copy-paste implementation prompt.
   Then stop — implementation is a separate engagement.

## Output contract

```
QUADRANT WALK: current <quadrant> · coverage <n/4> · stopped for user reaction? <yes/no>

KNOWN KNOWNS:
- <settled fact> — evidence: <file:line>
- <assumption> — settled unless challenged

KNOWN UNKNOWNS:
- Q: <question> | recommend: <lettered answer> | closed by: user | territory | OPEN | unblocks: <what>

UNKNOWN KNOWNS:
- tacit constraint: <extracted> | reshaped the target: <how>

UNKNOWN UNKNOWNS:
- landmine: <name> | evidence: <file:line> | why it bites: <mechanism> | changes: <impact> | status: decided | OPEN | sharp-edge

HANDOVER MAP: path <.ratchet/unknowns-map.md> · OPEN items <n> · build plan <yes/no>
IMPLEMENTATION PROMPT: <copy-paste line that launches the build with the map's context>
```

## Serialize

The map is durable state, not scrollback. Record it so the next context resumes cold:

```
ratchet artifact add '{"kind":"unknown-map","title":"unknowns map: <target>","status":"handoff","path":".ratchet/unknowns-map.md","holes":["<each OPEN item>"]}'
ratchet state append decisions  '{"choice":"<closed known-unknown>","rejected":"<the option not taken>","tripwire":"<what would reopen it>"}'
ratchet state append assumptions '{"text":"<tacit/working assumption>","killTest":"<cheapest falsification>","status":"untested"}'
ratchet state append openLoops   '{"text":"OPEN: <question> — unblocks: <what>","status":"open"}'
ratchet state set phase cut
ratchet state set nextCommand "/ratchet:build"
```

Real landmines that are actual failures (not just sharp edges) are defects, not notes:

```
ratchet defect add '{"severity":"high","summary":"<landmine that will bite the build>"}'
```

The map's OPEN loops, untested assumptions, and artifact holes all drain
`ratchet score confidence` on purpose — an unclosed unknown is tracked pressure, not a
forgotten one. The score cannot read ship-ready while the fog is still on the board.

## Meter — when to reach for this

Run `/ratchet:map` when the aperture earns it, not on a reversible one-liner:

```
ratchet score aperture '{"ambiguity":_,"terrain":_,"taste":_,"blastRadius":_,"reversibility":_}'
```

- **A0–A2** → don't. `/ratchet:lock` + infer-and-build is the right, anti-ceremony move.
- **A3** → map the fog, then build.
- **A4** → map the fog, hand over the plan/options, and **stop** — do not build until
  constraints are locked.

Also reach for it directly (whatever the score) on a reference-implementation port, an
"I'll know it when I see it" request, or a mid-build deviation that needs capturing.

Next: when the map is handed over and the user picks the build plan → `/ratchet:build`.
At A4, lock the open constraints first (`/ratchet:lock`) and stop before building.
