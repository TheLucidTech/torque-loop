# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Codex install metadata: `.codex-plugin/plugin.json` plus a repo-local
  `.agents/plugins/marketplace.json`, so the plugin can be registered and installed by
  Codex CLI and surfaced in the Codex app.

### Changed

- Package metadata and plugin-shape tests now cover both Claude Code and Codex manifests.
- Repo snapshots now surface `.agents` and `.codex-plugin` alongside the existing
  plugin-critical dot directories.

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

[Unreleased]: https://github.com/TheLucidTech/torque-loop/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/TheLucidTech/torque-loop/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TheLucidTech/torque-loop/releases/tag/v0.1.0
