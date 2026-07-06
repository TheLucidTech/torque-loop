'use strict';

const fs = require('fs');
const path = require('path');

const state = require('./state');
const ledger = require('./ledger');
const scoring = require('./scoring');
const artifacts = require('./artifacts');
const repo = require('./repoSnapshot');
const gitRefs = require('./gitRefs');
const coldStart = require('./coldStart');
const md = require('./markdown');
const receipt = require('./receipt');
const journal = require('./evolve/journal');
const schemas = require('./schemas');

const VERSION = require('../package.json').version;
const PLUGIN_ROOT = path.resolve(__dirname, '..');

function out(s) {
  process.stdout.write(String(s) + '\n');
}
function err(s) {
  process.stderr.write(String(s) + '\n');
}

// Resolve a JSON payload from: raw string, @file, or "-" (stdin).
function readPayload(arg) {
  if (arg == null) throw new Error('expected a JSON payload (string, @file, or - for stdin)');
  let raw;
  if (arg === '-') raw = fs.readFileSync(0, 'utf8');
  else if (arg.startsWith('@')) raw = fs.readFileSync(arg.slice(1), 'utf8');
  else raw = arg;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON payload: ${e.message}`);
  }
}

function readStdinSafe() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return '';
  }
}

function coerceScalar(key, value) {
  if (key === 'dirty') return value === 'true' || value === true;
  if (key === 'confidence') return value === '' ? null : Number(value);
  return value;
}

// Minimal `--key value` parser for subcommands that carry real values (defect
// lifecycle). The top-level router treats every `--flag` as boolean, which is
// fine for switches like --json but drops values like --evidence "<text>".
// Declared booleans never swallow the following positional.
function parseArgv(argv, { booleans = [] } = {}) {
  const boolSet = new Set(booleans);
  const positionals = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a === 'string' && a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        opts[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!boolSet.has(key) && next != null && !String(next).startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, opts };
}

// A flag value is only usable if it is a non-empty string; a bare `--evidence`
// (no value) parses as `true` and must be rejected, not stringified to "true".
function strOpt(v) {
  return v == null || v === true ? '' : String(v).trim();
}

// ---------------------------------------------------------------------------
// Agent memory isolation (propose-only). Registered agents get isolated memory
// by ROLE, enforced at the CLI boundary: only the scribe writes canonical state.
// A builder or auditor is a propose-only agent — it emits the mutation for the
// caller (or the scribe) to run, and its own process is refused write access, so
// two agents can never clobber each other's record. Identity comes from
// RATCHET_AGENT; the writer set is the scribe (and the unset/main caller). This
// is a guard, not a sandbox: it makes the propose-only contract the agents
// already follow impossible to violate by accident.
// ---------------------------------------------------------------------------

const WRITER_AGENTS = new Set(['scribe']);

// Returns the propose-only agent name if one is active, else ''. The main caller
// (RATCHET_AGENT unset) and the scribe both return '' — they may write.
function proposeOnlyAgent() {
  const a = (process.env.RATCHET_AGENT || '').trim().toLowerCase();
  return a && !WRITER_AGENTS.has(a) ? a : '';
}

// Throw before any canonical-state mutation if a propose-only agent is driving.
// The message tells the agent what to do instead — emit the command, don't run it.
function assertMayWrite(action) {
  const a = proposeOnlyAgent();
  if (a) {
    throw new Error(
      `agent "${a}" has propose-only memory and may not mutate canonical state (${action}). ` +
        'Emit the exact command for the caller or the ratchet-scribe to run instead. ' +
        '(Only the scribe writes canonical state; unset RATCHET_AGENT for the main caller, or set it to scribe.)'
    );
  }
}

// ---------------------------------------------------------------------------
// Command table.
// ---------------------------------------------------------------------------

function run(argv) {
  const args = argv.slice(2);
  const cwd = process.cwd();
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  const asJson = flags.has('--json');
  const [group, sub, ...rest] = pos;

  // `--version` / `--help` are flags, so they never land in `group`; handle them
  // up front or `ratchet --version` silently falls through to the help text.
  if (flags.has('--version')) return out(`ratchet ${VERSION}`);
  if (flags.has('--help') && group == null) return help();

  switch (group) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      return help();

    case 'version':
    case '-v':
    case '--version':
      return out(`ratchet ${VERSION}`);

    case 'init': {
      // `init --force` resets the store — a canonical mutation. Plain init only
      // ensures the dir exists, so a propose-only agent may still orient.
      if (flags.has('--force')) assertMayWrite('init --force');
      const res = state.initProject(cwd, { force: flags.has('--force') });
      return out(`Ratchet initialized at ${res.dir}${res.created ? '' : ' (already existed)'}`);
    }

    case 'state':
      return cmdState(cwd, sub, rest, asJson, flags);

    case 'receipt': {
      const r = receipt.assemble(cwd);
      // --save writes the source-of-truth index: one always-current file a cold
      // agent can read instead of doing archaeology. Derived + regenerable, so it
      // is not a canonical-state write (propose-only agents may refresh it).
      if (flags.has('--save')) {
        const dir = path.join(cwd, '.ratchet');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(r, null, 2) + '\n', 'utf8');
        fs.writeFileSync(path.join(dir, 'current.md'), md.receipt(r) + '\n', 'utf8');
        if (!asJson) out(`saved .ratchet/current.json + .ratchet/current.md`);
      }
      return out(asJson ? JSON.stringify(r, null, 2) : md.receipt(r));
    }

    case 'ledger':
      return cmdLedger(cwd, sub, rest, asJson);

    case 'artifact': {
      if (sub !== 'add') throw new Error('usage: ratchet artifact add <json>');
      assertMayWrite('artifact add');
      const rec = artifacts.addArtifact(cwd, readPayload(rest[0]));
      return out(`artifact ${rec.id} added: ${rec.title} (${rec.status})`);
    }

    case 'defect':
      return cmdDefect(cwd, args, asJson);

    case 'retract':
      return cmdRetract(cwd, args);

    case 'score':
      return cmdScore(cwd, sub, rest, asJson);

    case 'snapshot': {
      const target = rest[0] || cwd;
      const snap = repo.snapshot(target);
      return out(asJson ? JSON.stringify(snap, null, 2) : md.repoSnapshot(snap));
    }

    case 'git': {
      if (sub !== 'status-refs' && sub !== 'status') {
        throw new Error('usage: ratchet git status-refs [--json]');
      }
      const refs = gitRefs.statusRefs(cwd);
      return out(asJson ? JSON.stringify(refs, null, 2) : md.gitStatusRefs(refs));
    }

    case 'export':
      return cmdExport(cwd, sub);

    case 'status': {
      const s = state.loadState(cwd);
      return out(asJson ? JSON.stringify(s, null, 2) : md.stateSummary(s));
    }

    case 'compile': {
      if (sub !== 'done') throw new Error('usage: ratchet compile done');
      assertMayWrite('compile done');
      return cmdCompileDone(cwd);
    }

    case 'doctor':
      if (sub === 'cold-start') return cmdColdStart(cwd, asJson);
      return cmdDoctor(cwd, asJson);

    case 'touch': {
      const file = sub;
      if (!file) throw new Error('usage: ratchet touch <file>');
      assertMayWrite('touch');
      const s = state.loadState(cwd);
      s.touchedFiles.push({ path: file, at: schemas.nowIso() });
      s.dirty = true;
      state.saveState(cwd, s);
      return out(`touched ${file}`);
    }

    case 'hook':
      return cmdHook(cwd, sub);

    default:
      err(`unknown command: ${group}`);
      help();
      process.exitCode = 2;
  }
}

function cmdState(cwd, sub, rest, asJson, flags = new Set()) {
  switch (sub) {
    case undefined:
    case 'get': {
      const s = state.loadState(cwd);
      const key = rest[0];
      if (key) {
        const v = s[key];
        return out(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v == null ? '' : v));
      }
      return out(asJson ? JSON.stringify(s, null, 2) : md.stateSummary(s));
    }
    case 'set': {
      assertMayWrite('state set');
      const [key, ...valueParts] = rest;
      if (!key) throw new Error('usage: ratchet state set <key> <value>');
      if (!schemas.STATE_SCALARS.has(key)) {
        throw new Error(`"${key}" is not a settable scalar. valid: ${[...schemas.STATE_SCALARS].join(', ')}`);
      }
      const value = valueParts.join(' ');
      const s = state.loadState(cwd);
      s[key] = coerceScalar(key, value);
      if (key !== 'dirty') s.dirty = true;
      s.history.push({ id: state.makeId('hist'), at: schemas.nowIso(), event: 'state.set', note: `${key} = ${value}` });
      state.saveState(cwd, s);
      return out(`${key} set`);
    }
    case 'append': {
      assertMayWrite('state append');
      const [collection, payloadArg] = rest;
      if (!schemas.STATE_COLLECTIONS[collection]) {
        throw new Error(`unknown collection "${collection}". valid: ${Object.keys(schemas.STATE_COLLECTIONS).join(', ')}`);
      }
      const item = readPayload(payloadArg);
      const s = state.loadState(cwd);
      const record = { id: item.id || state.makeId(schemas.STATE_COLLECTIONS[collection]), at: schemas.nowIso(), ...item };
      s[collection].push(record);
      s.dirty = true;
      state.saveState(cwd, s);
      return out(`appended to ${collection}: ${record.id}`);
    }
    case 'reset': {
      assertMayWrite('state reset');
      // Authority gate: wiping session state (objective, defects, artifacts,
      // decisions, history) is irreversible. Like every other irreversible verb
      // in the CLI, it must be explicitly authorized — a bare `state reset` must
      // not be able to erase the record by accident.
      if (!flags.has('--force')) {
        throw new Error(
          'ratchet state reset wipes all session state (objective, defects, artifacts, decisions, history) — ' +
            'this is irreversible. Re-run with --force to authorize.'
        );
      }
      state.initProject(cwd, { force: true });
      return out('state reset');
    }
    default:
      throw new Error(`unknown state subcommand: ${sub}`);
  }
}

function cmdLedger(cwd, sub, rest, asJson) {
  switch (sub) {
    case 'create': {
      assertMayWrite('ledger create');
      const l = ledger.create(cwd);
      return out(`ledger ready (${md.dash(l.updatedAt)})`);
    }
    case 'update': {
      assertMayWrite('ledger update');
      const [collection, payloadArg] = rest;
      const res = ledger.upsert(cwd, collection, readPayload(payloadArg));
      return out(`${res.action} ${collection}: ${res.item.id}`);
    }
    case undefined:
    case 'get': {
      const l = state.loadLedger(cwd);
      if (asJson) return out(JSON.stringify(l, null, 2));
      const s = ledger.summary(l);
      return out(
        `### QA ledger\n- Features: ${s.features}\n- Tests: ${s.tests} (${s.failingTests} failing)\n- Defects: ${s.defects} (${s.openDefects} open)`
      );
    }
    default:
      throw new Error(`unknown ledger subcommand: ${sub}`);
  }
}

// Defect lifecycle — the mutation the CLI lacked in 0.2. `add` keeps its JSON
// contract; every other verb transitions an existing defect by id and (for the
// clearing verbs) demands the proof/reason that makes the clear honest.
function cmdDefect(cwd, argv, asJson) {
  // argv still includes the leading "defect" group token → positionals[0].
  const { positionals, opts } = parseArgv(argv, { booleans: ['json'] });
  const sub = positionals[1];
  const id = positionals[2];
  const json = asJson || opts.json === true;

  const need = (val, msg) => {
    if (!val) throw new Error(msg);
    return val;
  };

  // Read verbs (list/get) are open to every agent; the mutating verbs are not.
  if (sub && sub !== 'list' && sub !== 'get') assertMayWrite(`defect ${sub}`);

  switch (sub) {
    case 'add': {
      const rec = artifacts.addDefect(cwd, readPayload(positionals[2]));
      return out(`defect ${rec.state.id} added: [${rec.state.severity}] ${rec.state.summary}`);
    }
    case 'list': {
      const s = state.loadState(cwd);
      return out(json ? JSON.stringify(s.defects || [], null, 2) : md.defectList(s.defects || []));
    }
    case 'get': {
      need(id, 'usage: ratchet defect get <id> [--json]');
      const s = state.loadState(cwd);
      const d = (s.defects || []).find((x) => x.id === id);
      if (!d) throw new Error(`no defect with id "${id}"`);
      return out(json ? JSON.stringify(d, null, 2) : md.defectOne(d));
    }
    case 'resolve': {
      need(id, 'usage: ratchet defect resolve <id> --evidence "<proof>"');
      const evidence = strOpt(opts.evidence);
      // Proof gate, same spirit as the evolve KEEP gate: a defect cannot be
      // marked fixed without stating the proof that it is actually fixed.
      need(evidence, 'defect resolve requires --evidence "<proof it is actually fixed>" — no proof, no resolve');
      artifacts.transitionDefect(cwd, id, 'resolved', { evidence, note: `resolved: ${evidence}` });
      return out(`defect ${id} → resolved`);
    }
    case 'reopen': {
      need(id, 'usage: ratchet defect reopen <id> --reason "<why>"');
      const reason = strOpt(opts.reason);
      need(reason, 'defect reopen requires --reason "<why it is not actually fixed>"');
      artifacts.transitionDefect(cwd, id, 'reopened', { reason, note: `reopened: ${reason}` });
      return out(`defect ${id} → reopened`);
    }
    case 'waive': {
      need(id, 'usage: ratchet defect waive <id> --owner "<name>" --reason "<why>"');
      const owner = strOpt(opts.owner);
      const reason = strOpt(opts.reason);
      need(owner, 'defect waive requires --owner "<who accepts the risk>"');
      need(reason, 'defect waive requires --reason "<why shipping anyway is acceptable>"');
      artifacts.transitionDefect(cwd, id, 'waived', { owner, reason, note: `waived by ${owner}: ${reason}` });
      return out(`defect ${id} → waived (owner: ${owner})`);
    }
    case 'supersede': {
      need(id, 'usage: ratchet defect supersede <id> --by <artifact-or-defect-id>');
      const by = strOpt(opts.by);
      need(by, 'defect supersede requires --by <artifact-or-defect-id>');
      const reason = strOpt(opts.reason);
      artifacts.transitionDefect(cwd, id, 'superseded', {
        by,
        reason,
        note: `superseded by ${by}${reason ? `: ${reason}` : ''}`,
      });
      return out(`defect ${id} → superseded (by: ${by})`);
    }
    default:
      throw new Error(
        'usage: ratchet defect <add|list|get|resolve|reopen|waive|supersede> ...' + (sub ? ` (got "${sub}")` : '')
      );
  }
}

// Retract an artifact whose central claim became false or obsolete. Requires a
// reason (proof-gate spirit: never retract silently); --superseded-by links the
// replacement so provenance survives.
function cmdRetract(cwd, argv) {
  assertMayWrite('retract');
  const { positionals, opts } = parseArgv(argv, {});
  const id = positionals[1];
  if (!id) throw new Error('usage: ratchet retract <artifact-id> --reason "<why>" [--superseded-by <id>]');
  const reason = strOpt(opts.reason);
  if (!reason) throw new Error("retract requires --reason \"<why this artifact's claim is false or obsolete>\"");
  const supersededBy = strOpt(opts['superseded-by']);
  artifacts.retractArtifact(cwd, id, { reason, supersededBy });
  return out(`artifact ${id} retracted${supersededBy ? ` (superseded by ${supersededBy})` : ''}`);
}

// Serialize the fog the moment the dial names it (a write). Steering the state
// never saw cannot drain confidence, warn a cold start, or survive a handoff.
// A propose-only agent still gets the read — no footprint; an already-open fog
// loop or a live unknown-map means the fog is already on the record. The loop
// closes itself when the unknown-map artifact lands (artifacts.js). Returns
// true only when a fog loop was actually written.
function recordApertureFog(cwd, result) {
  if (!result.mapRequired || proposeOnlyAgent()) return false;
  const s = state.loadState(cwd);
  const openFog = (s.openLoops || []).some(
    (l) => l.status !== 'closed' && String(l.text || '').startsWith(schemas.FOG_LOOP_PREFIX)
  );
  const liveMap = (s.artifacts || []).some(
    (a) => a.kind === 'unknown-map' && a.status !== 'retracted' && a.status !== 'superseded'
  );
  if (openFog || liveMap) return false;
  const now = schemas.nowIso();
  s.openLoops.push({
    id: state.makeId('loop'),
    at: now,
    text: `${schemas.FOG_LOOP_PREFIX} (aperture ${result.level}, score ${result.score}/10) — run /ratchet:map; closes when the unknown-map artifact lands`,
    status: 'open',
  });
  s.dirty = true;
  s.history.push({ id: state.makeId('hist'), at: now, event: 'fog.recorded', note: `aperture ${result.level} raised mapRequired` });
  state.saveState(cwd, s);
  return true;
}

function cmdScore(cwd, sub, rest, asJson) {
  switch (sub) {
    case 'friction': {
      const result = scoring.scoreFriction(readPayload(rest[0]));
      return out(asJson ? JSON.stringify(result, null, 2) : md.friction(result));
    }
    case 'confidence': {
      const s = state.loadState(cwd);
      const ledger = state.loadLedger(cwd);
      let events = [];
      try {
        events = journal.readEvents(cwd);
      } catch (_e) {
        events = [];
      }
      const layers = scoring.scoreConfidenceLayers(s, ledger, events);
      if (asJson) return out(JSON.stringify(layers, null, 2));
      // Cache the session score back into state (a write). A propose-only agent
      // still gets the read — it just leaves no footprint.
      if (!proposeOnlyAgent()) {
        s.confidence = layers.session.score;
        state.saveState(cwd, s);
      }
      return out(md.confidenceLayers(layers));
    }
    case 'aperture': {
      const result = scoring.scoreAperture(readPayload(rest[0]));
      // Serialize the fog on BOTH output modes — a mapRequired that lives only
      // on stdout is the undrained-fog hole, and --json callers (the ones most
      // likely to automate this read) must not silently bypass the write. The
      // JSON result says whether the write happened (recordedFog).
      const recordedFog = recordApertureFog(cwd, result);
      if (asJson) return out(JSON.stringify({ ...result, recordedFog }, null, 2));
      return out(
        md.aperture(result) +
          (recordedFog
            ? '\n_Fog recorded as an open loop — it drains confidence until `/ratchet:map` lands the unknown-map artifact._'
            : '')
      );
    }
    default:
      throw new Error(`unknown score subcommand: ${sub} (friction | confidence | aperture)`);
  }
}

function cmdExport(cwd, sub) {
  const s = state.loadState(cwd);
  if (sub === 'json') return out(JSON.stringify(s, null, 2));
  const l = state.loadLedger(cwd);
  return out(md.fullExport(s, l));
}

// ---------------------------------------------------------------------------
// Hooks. These read Claude Code hook JSON on stdin and MUST never throw in a
// way that disrupts the session — always exit 0.
// ---------------------------------------------------------------------------

function cmdHook(cwd, sub) {
  try {
    switch (sub) {
      case 'session-start': {
        state.initProject(cwd);
        return; // silent
      }
      case 'post-edit': {
        const raw = readStdinSafe();
        let file = '';
        try {
          const data = JSON.parse(raw || '{}');
          file = data?.tool_input?.file_path || data?.tool_input?.path || data?.file_path || '';
        } catch (_e) {
          /* ignore malformed */
        }
        if (file) {
          const s = state.loadState(cwd);
          s.touchedFiles.push({ path: file, at: schemas.nowIso() });
          s.dirty = true;
          state.saveState(cwd, s);
        }
        return; // silent, non-blocking
      }
      case 'stop-check': {
        const s = state.loadState(cwd);
        const stale = s.dirty && (!s.lastCompileAt || s.lastCompileAt < s.updatedAt);
        if (stale) {
          const n = (s.touchedFiles || []).length;
          err(
            `[ratchet] Work changed since last compile${n ? ` (${n} file touch(es) tracked)` : ''}. ` +
              `Run /ratchet:compile to serialize state before the trail goes cold.`
          );
        }
        return;
      }
      default:
        return;
    }
  } catch (_e) {
    // Hooks fail closed: never break the session.
  }
}

// Atomically mark a session as compiled. Unlike `state set`, this CLEARS dirty
// (so the Stop hook stops nagging) and stamps lastCompileAt in one move. Compile
// completion is an event, not a scalar edit — it must never re-dirty the state.
function cmdCompileDone(cwd) {
  const now = schemas.nowIso();
  const s = state.loadState(cwd);
  s.lastCompileAt = now;
  s.dirty = false;
  s.history.push({ id: state.makeId('hist'), at: now, event: 'compile.done', note: 'state serialized' });
  state.saveState(cwd, s);
  return out('compiled — dirty cleared, state serialized');
}

// Extract the raw YAML frontmatter block from a SKILL.md / agent .md file.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : null;
}

// "Is my plugin healthy?" — validate the plugin shape against what Claude Code
// and Codex expect, plus version alignment and a live state/snapshot check.
// Exits non-zero on any failure so CI and `npm test` can gate a release on it.
function cmdDoctor(cwd, asJson) {
  const root = PLUGIN_ROOT;
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail || '' });
  const readJsonFile = (rel) => {
    try {
      return { ok: true, data: JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const major = Number(process.versions.node.split('.')[0]);
  add('node >= 18', major >= 18, `found ${process.version}`);

  const pkg = readJsonFile('package.json');
  add('package.json parses', pkg.ok, pkg.ok ? '' : pkg.error);
  const claudePlugin = readJsonFile('.claude-plugin/plugin.json');
  add('.claude-plugin/plugin.json parses', claudePlugin.ok, claudePlugin.ok ? '' : claudePlugin.error);
  const claudeMarket = readJsonFile('.claude-plugin/marketplace.json');
  add('.claude-plugin/marketplace.json parses', claudeMarket.ok, claudeMarket.ok ? '' : claudeMarket.error);
  const codexPlugin = readJsonFile('.codex-plugin/plugin.json');
  add('.codex-plugin/plugin.json parses', codexPlugin.ok, codexPlugin.ok ? '' : codexPlugin.error);
  const codexMarket = readJsonFile('.agents/plugins/marketplace.json');
  add('.agents/plugins/marketplace.json parses', codexMarket.ok, codexMarket.ok ? '' : codexMarket.error);

  if (pkg.ok && claudePlugin.ok && claudeMarket.ok && codexPlugin.ok) {
    const pv = pkg.data.version;
    const others = [
      ['.claude-plugin/plugin.json', claudePlugin.data.version],
      ['.claude-plugin/marketplace.metadata', claudeMarket.data.metadata && claudeMarket.data.metadata.version],
      ['.claude-plugin/marketplace.plugins[0]', claudeMarket.data.plugins && claudeMarket.data.plugins[0] && claudeMarket.data.plugins[0].version],
      ['.codex-plugin/plugin.json', codexPlugin.data.version],
    ];
    const mismatch = others.filter(([, v]) => v !== pv).map(([k, v]) => `${k}=${v}`);
    add('versions aligned', mismatch.length === 0, mismatch.length ? `package=${pv} but ${mismatch.join(', ')}` : `all ${pv}`);
  }

  if (codexPlugin.ok) {
    const iface = codexPlugin.data.interface || {};
    const required = ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category'];
    const missing = required.filter((field) => !iface[field]);
    add('Codex manifest required interface fields exist', missing.length === 0, missing.join(', '));
    add('Codex manifest points at skills', codexPlugin.data.skills === './skills/');
  }

  if (codexPlugin.ok && codexMarket.ok) {
    const plugins = Array.isArray(codexMarket.data.plugins) ? codexMarket.data.plugins : [];
    const entry = plugins.find((p) => p && p.name === codexPlugin.data.name);
    add('Codex marketplace entry exists', Boolean(entry), codexPlugin.data.name);
    if (entry) {
      const sourceOk = entry.source && entry.source.source === 'local' && entry.source.path === './';
      const policyOk = entry.policy && entry.policy.installation === 'AVAILABLE' && entry.policy.authentication === 'ON_INSTALL';
      add('Codex marketplace source is local repo root', sourceOk);
      add('Codex marketplace policy is installable', policyOk);
    }
  }

  for (const d of ['.agents', '.claude-plugin', '.codex-plugin', 'skills', 'agents', 'hooks', 'bin', 'src']) {
    const p = path.join(root, d);
    add(`dir ${d}/ exists`, fs.existsSync(p) && fs.statSync(p).isDirectory());
  }

  const hooks = readJsonFile('hooks/hooks.json');
  add('hooks/hooks.json parses', hooks.ok, hooks.ok ? '' : hooks.error);

  add('bin/ratchet exists', fs.existsSync(path.join(root, 'bin', 'ratchet')));
  add('bin/ratchet-evolve exists', fs.existsSync(path.join(root, 'bin', 'ratchet-evolve')));

  const skillProblems = [];
  try {
    for (const name of fs.readdirSync(path.join(root, 'skills'))) {
      const skillMd = path.join(root, 'skills', name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) {
        skillProblems.push(`${name}: no SKILL.md`);
        continue;
      }
      const fm = frontmatter(fs.readFileSync(skillMd, 'utf8'));
      if (!fm) skillProblems.push(`${name}: no frontmatter`);
      else if (!/(^|\n)description:/.test(fm)) skillProblems.push(`${name}: no description`);
    }
  } catch (e) {
    skillProblems.push(e.message);
  }
  add('every skills/*/SKILL.md has frontmatter + description', skillProblems.length === 0, skillProblems.join('; '));

  let stateDetail = '';
  let stateOk = true;
  try {
    state.initProject(cwd);
    stateDetail = state.projectDir(cwd);
  } catch (e) {
    stateOk = false;
    stateDetail = e.message;
  }
  add('state dir writable', stateOk, stateDetail);

  let snapOk = true;
  let snapDetail = '';
  try {
    const snap = repo.snapshot(cwd);
    snapDetail = `${snap.fileCount} files`;
  } catch (e) {
    snapOk = false;
    snapDetail = e.message;
  }
  add('repo snapshot works', snapOk, snapDetail);

  const failed = checks.filter((c) => !c.ok);
  if (asJson) {
    out(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  } else {
    out('ratchet doctor');
    out('');
    for (const c of checks) out(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    out('');
    out(failed.length === 0 ? 'healthy — plugin shape looks good.' : `${failed.length} problem(s) found.`);
  }
  if (failed.length) process.exitCode = 1;
}

// Cold-start poison scan: does the current state / operator surfaces steer the
// next session into the wrong world? Generic ratchet-state checks always run;
// project surfaces are opt-in via .ratchet/cold-start.json. FAIL = contradiction.
function cmdColdStart(cwd, asJson) {
  const result = coldStart.scan(cwd);
  if (asJson) {
    out(JSON.stringify(result, null, 2));
  } else {
    out('ratchet doctor cold-start');
    out('');
    for (const c of result.checks) {
      const tag = c.level === 'ok' ? 'ok  ' : c.level === 'warn' ? 'warn' : 'FAIL';
      out(`  ${tag} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    out('');
    const fails = result.checks.filter((c) => c.level === 'fail').length;
    const warns = result.checks.filter((c) => c.level === 'warn').length;
    if (fails) out(`${fails} contradiction(s), ${warns} warning(s) — cold-start surfaces may steer the next session wrong.`);
    else if (warns) out(`no contradictions, ${warns} warning(s).`);
    else out('clean — no stale steering detected.');
    if (!result.configured) out('(generic checks only — add .ratchet/cold-start.json to scan project surfaces)');
  }
  if (!result.ok) process.exitCode = 1;
}

function help() {
  out(
    [
      `ratchet ${VERSION} — consequence-engine state tooling`,
      '',
      'RESUME',
      '  ratchet receipt [--json] [--save] one stable cockpit: target·delta·proof·verdict·risk·authority·state·next',
      '                                    --save writes .ratchet/current.json + .md (the source-of-truth index)',
      '',
      'STATE',
      '  ratchet init [--force]              create/reset project data dir',
      '  ratchet status [--json]            render current state',
      '  ratchet state get [key] [--json]   read state (or one key)',
      '  ratchet state set <key> <value>    set objective|title|bottleneck|phase|nextAction|nextCommand|...',
      '  ratchet state append <coll> <json> append to decisions|artifacts|defects|assumptions|openLoops|history',
      '  ratchet compile done               mark session compiled: clear dirty + stamp lastCompileAt',
      '  ratchet state reset --force        wipe session state (irreversible — --force required)',
      '',
      'ARTIFACTS & DEFECTS',
      '  ratchet artifact add <json>        record an artifact ({title,kind,status,path,holes})',
      '  ratchet defect add <json>          record a defect ({severity,summary,feature}) — also hits ledger',
      '  ratchet defect list [--json]       list defects (○ draining / ● terminal)',
      '  ratchet defect get <id> [--json]   show one defect + its lifecycle log',
      '  ratchet defect resolve <id> --evidence "<proof>"            mark fixed (proof required)',
      '  ratchet defect reopen <id> --reason "<why>"                 a resolved defect regressed',
      '  ratchet defect waive <id> --owner "<name>" --reason "<why>" accept the risk, stop the drain',
      '  ratchet defect supersede <id> --by <artifact-id>            replaced by newer work',
      '  ratchet retract <id> --reason "<why>" [--superseded-by <id>] retract a false/obsolete artifact',
      '',
      'LEDGER (QA canonical record)',
      '  ratchet ledger create              ensure ledger exists',
      '  ratchet ledger update <coll> <json> upsert features|tests|defects',
      '  ratchet ledger get [--json]        ledger summary',
      '',
      'SCORING',
      '  ratchet score friction <json>      rank obstacles ([{name,leverage,certainty,speed,risk}])',
      '  ratchet score confidence           three scoped layers: artifact · session · ledger health',
      '  ratchet score aperture <json>      meter loop depth from uncertainty ({ambiguity,terrain,taste,blastRadius,reversibility} 0-2)',
      '',
      'CONTEXT',
      '  ratchet snapshot repo [path]       cheap repo read (files, dirs, git)',
      '  ratchet git status-refs [--json]   ahead/behind vs every base ref, each named',
      '  ratchet export markdown            full session compile',
      '  ratchet export json                raw state',
      '',
      'PLUGIN HEALTH',
      '  ratchet doctor [--json]            check plugin shape, version alignment, state dir',
      '  ratchet doctor cold-start [--json] scan for stale steering (opt-in surfaces via .ratchet/cold-start.json)',
      '',
      'json args accept a raw string, @file, or - for stdin.',
      '',
      'AGENT MEMORY (isolation by role)',
      '  RATCHET_AGENT=<name>  identify the driving agent. Only the scribe writes canonical',
      '                        state; builder/auditor are propose-only — mutating verbs are',
      '                        refused so they emit the command instead of clobbering the record.',
    ].join('\n')
  );
}

module.exports = { run, VERSION };
