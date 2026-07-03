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
      return cmdCompileDone(cwd);
    }

    case 'doctor':
      if (sub === 'cold-start') return cmdColdStart(cwd, asJson);
      return cmdDoctor(cwd, asJson);

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
  const { positionals, opts } = parseArgv(argv, {});
  const id = positionals[1];
  if (!id) throw new Error('usage: ratchet retract <artifact-id> --reason "<why>" [--superseded-by <id>]');
  const reason = strOpt(opts.reason);
  if (!reason) throw new Error("retract requires --reason \"<why this artifact's claim is false or obsolete>\"");
  const supersededBy = strOpt(opts['superseded-by']);
  artifacts.retractArtifact(cwd, id, { reason, supersededBy });
  return out(`artifact ${id} retracted${supersededBy ? ` (superseded by ${supersededBy})` : ''}`);
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
      'STATE',
      '  ratchet init [--force]              create/reset project data dir',
      '  ratchet status [--json]            render current state',
      '  ratchet state get [key] [--json]   read state (or one key)',
      '  ratchet state set <key> <value>    set objective|title|bottleneck|phase|nextAction|nextCommand|...',
      '  ratchet state append <coll> <json> append to decisions|artifacts|defects|assumptions|openLoops|history',
      '  ratchet compile done               mark session compiled: clear dirty + stamp lastCompileAt',
      '  ratchet state reset                wipe session state',
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
      '  ratchet score confidence           compute session confidence + loop-clear',
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
    ].join('\n')
  );
}

module.exports = { run, VERSION };
