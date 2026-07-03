'use strict';

const fs = require('fs');

const state = require('./state');
const ledger = require('./ledger');
const scoring = require('./scoring');
const artifacts = require('./artifacts');
const repo = require('./repoSnapshot');
const md = require('./markdown');
const schemas = require('./schemas');

const VERSION = '0.1.0';

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
      const res = state.initProject(cwd, { force: flags.has('--force') });
      return out(`Ratchet initialized at ${res.dir}${res.created ? '' : ' (already existed)'}`);
    }

    case 'state':
      return cmdState(cwd, sub, rest, asJson);

    case 'ledger':
      return cmdLedger(cwd, sub, rest, asJson);

    case 'artifact': {
      if (sub !== 'add') throw new Error('usage: ratchet artifact add <json>');
      const rec = artifacts.addArtifact(cwd, readPayload(rest[0]));
      return out(`artifact ${rec.id} added: ${rec.title} (${rec.status})`);
    }

    case 'defect': {
      if (sub !== 'add') throw new Error('usage: ratchet defect add <json>');
      const rec = artifacts.addDefect(cwd, readPayload(rest[0]));
      return out(`defect ${rec.state.id} added: [${rec.state.severity}] ${rec.state.summary}`);
    }

    case 'score':
      return cmdScore(cwd, sub, rest, asJson);

    case 'snapshot': {
      const target = rest[0] || cwd;
      const snap = repo.snapshot(target);
      return out(asJson ? JSON.stringify(snap, null, 2) : md.repoSnapshot(snap));
    }

    case 'export':
      return cmdExport(cwd, sub);

    case 'status': {
      const s = state.loadState(cwd);
      return out(asJson ? JSON.stringify(s, null, 2) : md.stateSummary(s));
    }

    case 'touch': {
      const file = sub;
      if (!file) throw new Error('usage: ratchet touch <file>');
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

function cmdState(cwd, sub, rest, asJson) {
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
      const l = ledger.create(cwd);
      return out(`ledger ready (${md.dash(l.updatedAt)})`);
    }
    case 'update': {
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

function cmdScore(cwd, sub, rest, asJson) {
  switch (sub) {
    case 'friction': {
      const result = scoring.scoreFriction(readPayload(rest[0]));
      return out(asJson ? JSON.stringify(result, null, 2) : md.friction(result));
    }
    case 'confidence': {
      const s = state.loadState(cwd);
      const c = scoring.scoreConfidence(s);
      if (asJson) return out(JSON.stringify(c, null, 2));
      s.confidence = c.score;
      state.saveState(cwd, s);
      return out(md.confidence(s));
    }
    default:
      throw new Error(`unknown score subcommand: ${sub} (friction | confidence)`);
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

function help() {
  out(
    [
      `ratchet ${VERSION} — consequence-engine state tooling`,
      '',
      'STATE',
      '  ratchet init [--force]              create/reset project data dir',
      '  ratchet status [--json]            render current state',
      '  ratchet state get [key] [--json]   read state (or one key)',
      '  ratchet state set <key> <value>    set objective|title|bottleneck|phase|nextAction|nextCommand|...',
      '  ratchet state append <coll> <json> append to decisions|artifacts|defects|assumptions|openLoops|history',
      '  ratchet state reset                wipe session state',
      '',
      'ARTIFACTS & DEFECTS',
      '  ratchet artifact add <json>        record an artifact ({title,kind,status,path,holes})',
      '  ratchet defect add <json>          record a defect ({severity,summary,feature}) — also hits ledger',
      '',
      'LEDGER (QA canonical record)',
      '  ratchet ledger create              ensure ledger exists',
      '  ratchet ledger update <coll> <json> upsert features|tests|defects',
      '  ratchet ledger get [--json]        ledger summary',
      '',
      'SCORING',
      '  ratchet score friction <json>      rank obstacles ([{name,leverage,certainty,speed,risk}])',
      '  ratchet score confidence           compute session confidence + loop-clear',
      '',
      'CONTEXT',
      '  ratchet snapshot repo [path]       cheap repo read (files, dirs, git)',
      '  ratchet export markdown            full session compile',
      '  ratchet export json                raw state',
      '',
      'json args accept a raw string, @file, or - for stdin.',
    ].join('\n')
  );
}

module.exports = { run, VERSION };
