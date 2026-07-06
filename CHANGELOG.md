# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`/ratchet:map` — the pre-build fog gate.** The loop had no pre-build ambiguity pass:
  `/ratchet:cut` attacks assumptions, but nothing walked the codebase's tacit knowledge
  before building. `/ratchet:map` walks high-uncertainty work (aperture A3–A4, unfamiliar
  terrain, "I'll know it when I see it" taste, reference ports) through the four
  unknown-quadrants — known knowns (settled ground with `file:line` evidence), known
  unknowns (one blast-radius-ordered question at a time), unknown knowns (tacit taste
  surfaced by putting concrete options in front of the user), unknown unknowns (a swept
  landmine field) — and hands over one durable four-quadrant map, a build plan, and a
  copy-paste implementation prompt before any code is written. CLI-backed
  (`artifact kind:"unknown-map"`, decisions, assumptions, open loops), so its open items
  drain `ratchet score confidence` until closed; no schema change. Method grafted from
  dzhng/skills `explore-unknowns`, expressed in ratchet's own vocabulary.
- **Aperture routes through the map.** `ratchet score aperture` now folds `/ratchet:map`
  into the A3–A4 metered sequences (before `build`) and returns a `mapRequired` flag —
  true at A3+, or when a single dimension the summed score under-weights demands it
  (`taste = 2`, or `terrain = 2` with any `ambiguity`). `md.aperture()` renders
  **`Pre-build map: required`** so `/ratchet:ignite` routes high-uncertainty work through
  the fog gate instead of relying on the operator to remember. A4 still builds nothing.

## [0.5.0] - 2026-07-04 — Receipt

0.2 gated proof; 0.3 gated the *seam* of that proof; 0.4 metered the *depth* of the loop.
0.5 gives the loop a single cockpit: **one read — `ratchet receipt` — that says what is
true, what changed, what was proven, what is at risk, whether it is safe to ship, and
whether the receipt's own steering can be trusted.**

### Added

- **The receipt (`ratchet receipt`)** — one stable, always-same-shape read with eight fixed
  sections (TARGET · DELTA · PROOF · VERDICT · RISK · AUTHORITY · STATE · NEXT), joining session
  state, the evolve journal, the QA ledger, and git. Emptiness is stated, never omitted, so the
  shape never shifts between commands or sessions. `--json` emits the same structure for
  consumers; `--save` writes `.ratchet/current.json` + `current.md` as a gitignored
  source-of-truth index.
- **Three-layer confidence** — `ratchet score confidence` scores artifact · session · ledger
  independently, each naming its scope. A verified artifact stays ship-ready even when unrelated
  debt tanks session confidence — killing the "verified green but reported blocked" gaslight.
- **Cold-start control-plane scan** — the receipt runs the cold-start poison scan inline and
  renders `Control-plane scan: FAIL|WARN|clean` under STATE (also exposed as a top-level
  `controlPlane` field in `--json`), surfacing stale steering (retracted work still being pointed
  at) and misleading configured operator surfaces (e.g. unqualified git counts) in the one cold
  read — no separate doctor run. Project surfaces are an opt-in adapter declared in
  `.ratchet/cold-start.json`; no workspace path is hardcoded.

### Changed

- **`state reset` now requires `--force`** — an ungated canonical wipe is refused; the receipt
  AUTHORITY card renders the gates in force.
- **Agents are propose-only** — only the scribe writes canonical state; the builder and auditor
  are refused mutating verbs at the CLI boundary via `RATCHET_AGENT` (they read and propose).

## [0.4.0] - 2026-07-03 — Aperture

0.2 gated proof; 0.3 gated the *seam* of that proof. 0.4 adds the dial that decides how
much of the loop to run at all: **spend the full ratchet only when uncertainty earns it,
and snap when it doesn't.**

### Added

- **Aperture dial** — `ratchet score aperture <json>` scores five uncertainty dimensions
  (`ambiguity`, `terrain`, `taste`, `blastRadius`, `reversibility`, each 0–2), maps the
  total to a level A0–A4, and returns the exact ratchet skill sequence to run at that
  depth — from `build → verify` (A0 Snap) up to `lock → cut → decide` with **no build**
  until constraints are locked (A4 Max). A missing dimension defaults to neutral (1),
  never certain (0), so unknown uncertainty opens the aperture rather than closing it.
- **Aperture Read in `/ratchet:ignite`** — the master loop now meters itself: it scores
  the task first and runs only the depth uncertainty earns, instead of always running all
  seven steps. `/ratchet:lock` gained a matching "meter what follows" note.

### Changed

- `/ratchet:ignite` reframed from "run all seven; do not skip" to "run the aperture's
  metered sequence" — the seven-step pipeline is now the A2 default, not the floor.
- Bumped package, both plugin manifests, and the marketplace manifest to `0.4.0`.

## [0.3.0] - 2026-07-03 — Seam Gate

Where 0.2 made the loop **require proof**, 0.3 asks whether the proof is about the
thing you are actually shipping. A proxy evaluation can produce the right-looking
number and still point at the wrong decision, so a production `KEEP` now needs
evidence from the exact ship seam — and remediated defects can finally be cleared,
waived, or superseded through the CLI instead of blocking confidence forever.

**No proof → no keep** (0.2). **Wrong proof → no ship** (0.3).

### Added

- **Defect lifecycle** — `ratchet defect resolve | reopen | waive | supersede`,
  plus `list` and `get`. `resolve` requires `--evidence`; `waive` requires
  `--owner` and `--reason`; `supersede` links the replacement with `--by`. Each
  transition is logged per-defect and mirrored into the QA ledger. This is the
  mutation 0.2 lacked: a defect could be born but never cleared, so remediated
  work stayed confidence-blocking forever.
- **Seam-fidelity metadata on evolution events** — a verification can now record
  `evidenceType`, `method`, `independentFromBuilderMethod`, `testedSeam`,
  `shipSeam`, `seamMatch`, and `proxyWarning`.
- **Seam gate** — a production-code (`mode: code`) `KEEP` is rejected unless the
  evidence seam is an exact match for the ship seam, or a named human waiver is
  supplied. Verification that repeats the builder's own method is rejected as not
  independent.
- **`ratchet retract <id>`** — retract an artifact whose claim became false or
  obsolete (`--reason`, `--superseded-by`). Provenance is preserved
  (`keptForProvenance`), and a retracted artifact's holes stop draining confidence.
- **`ratchet git status-refs`** — base-qualified git status: every ahead/behind
  count names the ref it was measured against — never a bare "ahead of main".
- **`ratchet doctor cold-start`** — scans for stale steering that would start the
  next session in the wrong world. Generic ratchet-state checks always run;
  project operator surfaces (goal files, decision sheets) are an opt-in adapter
  via `.ratchet/cold-start.json`. No workspace path is hardcoded, and a
  declared-but-unimplemented check warns rather than silently passing. See
  `templates/cold-start.example.json`.
- **`REVERTED_AND_LEARNED`** — a first-class successful evolve outcome for a
  mutation reverted after verification that still left a reusable lesson. Evolve
  status counts it distinctly: corrected knowledge, no bad code kept.
- Codex install metadata: `.codex-plugin/plugin.json` plus a repo-local
  `.agents/plugins/marketplace.json`, so the plugin can be registered and installed by
  Codex CLI and surfaced in the Codex app.

### Changed

- Confidence scoring now treats `waived` and `superseded` defects as terminal
  (like `resolved` / `closed`) — a change proven necessary by a failing test
  before it was made. `resolved` handling was already correct and was left
  untouched.
- The terminal-defect predicate is centralized in `scoring.isDefectOpen` and
  consumed by the scorer, the state summary, and the QA ledger, so a cleared
  defect can never read as open on one surface while draining on another.
- The `ratchet` CLI gained a real `--key value` flag parser for subcommands that
  carry values (the router previously treated every `--flag` as boolean).
- Package metadata, `ratchet doctor`, and plugin-shape tests now cover both Claude Code
  and Codex manifests.
- npm packaging includes the Codex marketplace file explicitly as
  `.agents/plugins/marketplace.json`, without packaging the whole `.agents` tree.
- Repo snapshots now surface `.agents` and `.codex-plugin` alongside the existing
  plugin-critical dot directories.
- Bumped package, both plugin manifests, and the marketplace manifest to `0.3.0`.

### Fixed

- Remediated defects could never be cleared through the CLI, so they blocked
  confidence permanently. They can now be resolved, waived, or superseded.
- A production `KEEP` could be justified by a proxy evaluation that measured a
  different seam than the one it ships on. The seam gate now blocks that.

## [0.2.0] - 2026-07-03 — Proof Gate

Hardening, not expansion. This release makes the loop's philosophy mechanically true:
a cleaner command surface, an enforced proof gate, trustworthy state, and a verified
plugin shape. **No proof → no keep** is now enforced by code, not just by convention.

### Added

- **Proof gate.** `ratchet-evolve log append` now rejects a `KEEP` verdict that lacks
  verification evidence: a failed result, or no command/manual checks, or a `manual`
  result with no explicit checks, all throw before anything is written. `REVERT` and
  `ASK` are exempt by design.
- **`ratchet compile done`** — atomically stamps `lastCompileAt`, clears the dirty flag,
  and records a `compile.done` history event, so the Stop hook stops nagging after a
  compile.
- **`ratchet doctor`** — a plugin health check: Node version, manifest parsing, version
  alignment, required directories, every `SKILL.md` frontmatter/description, `hooks.json`,
  bin targets, state-dir writability, and a live repo-snapshot probe. Exits non-zero on
  any failure.
- **`ratchet-evolve next`** — reads the last recorded next edge (`--json` supported).
- **Manual-evidence templates** — `templates/evolve-event.json`,
  `templates/evolve-manual-checks.md`, and `templates/evolve-report.md`.
- **Plugin-shape test suite** (`test/plugin-shape.test.js`) — asserts manifests parse and
  align, CLI version constants match `package.json`, every skill has a valid `SKILL.md`,
  agents have frontmatter, bin targets exist, and the README command list matches the
  skill folders (and mentions no removed command names). Wired into `npm test` and CI.

### Changed

- **Renamed the evolution command** from `/ratchet:ratchet-evolve` to `/ratchet:evolve`
  (skill folder `skills/ratchet-evolve/` → `skills/evolve/`). The helper CLI binary stays
  `ratchet-evolve`. No compatibility alias is kept.
- `ratchet-evolve status` now reports kept / reverted / **asks** / active targets / last
  verdict / next edge.
- CLI version strings are now derived from `package.json`, making it the single source of
  truth for the plugin, both CLIs, and the marketplace manifest.
- The compile flow (`/ratchet:compile`, `ratchet-scribe`) now calls `ratchet compile done`
  instead of setting `lastCompileAt` by hand.
- Bumped package, plugin, and marketplace manifests to `0.2.0`.
- CI smoke-checks now include `ratchet doctor` and `ratchet-evolve status`.

### Fixed

- `--version` printed the full help text instead of the version, on both CLIs.
- The dirty-state Stop-hook reminder persisted after a compile; `ratchet compile done`
  now clears it.
- The evolution journal accepted `KEEP` events with no verification evidence.
- Repo snapshots hid plugin-critical dot directories (`.claude-plugin`, `.github`,
  `.claude`, `.ratchet`) via a blanket dot-dir skip; an allowlist now surfaces them while
  still ignoring `.git`, `node_modules`, and caches.
- Malformed `state.json` / `ledger.json` were silently discarded; they are now backed up
  to `<file>.corrupt.<timestamp>.json` before a fresh file is created.

### Removed

- `/ratchet:ratchet-evolve` (renamed to `/ratchet:evolve`).

## [0.1.0] - 2026-07-03

Initial public release.

### Added

- **Ratchet command family** (`/ratchet:*`) — the consequence-engine loop:
  `ignite`, `lock`, `auction`, `cut`, `mechanism`, `build`, `attack`, `verify`, `patch`,
  `decide`, `burn`, `push`, `compile`, `status`, `loop`.
- **Specialized commands** — `repo-audit`, `qa-ledger`, `prompt-audit`, `handoff`.
- **`/ratchet:ratchet-evolve`** — a bounded, evidence-gated mutation loop over a single
  artifact: LOCK → SNAPSHOT → PRESSURE → MUTATE → JUDGE → APPLY → VERIFY → KEEP/REVERT/ASK →
  RECORD → NEXT EDGE.
- **`ratchet` CLI** — the state engine (status, snapshot, scoring, artifact/defect records,
  markdown export) with per-project state under `$CLAUDE_PLUGIN_DATA` / `$RATCHET_DATA_DIR` /
  `~/.ratchet`.
- **`ratchet-evolve` CLI** — deterministic, evidence-gated evolution helpers (snapshot,
  score, verify, journal to `.ratchet/evolve-log.jsonl`).
- **Three agents** — `ratchet-builder`, `ratchet-auditor`, `ratchet-scribe`.
- **Conservative hooks** — SessionStart (ensure data dir), PostToolUse (track touched
  files), Stop (compile reminder). Never runs tests or edits on its own.
- Single-plugin marketplace manifest so the repo installs directly as a Claude Code plugin.
- Zero-dependency smoke test suites for the state engine and the evolution helpers.

[Unreleased]: https://github.com/TheLucidTech/torque-loop/compare/v0.5.0...HEAD
[0.4.0]: https://github.com/TheLucidTech/torque-loop/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TheLucidTech/torque-loop/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TheLucidTech/torque-loop/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TheLucidTech/torque-loop/releases/tag/v0.1.0
