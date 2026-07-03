'use strict';

const fs = require('fs');
const path = require('path');

const state = require('./state');
const scoring = require('./scoring');

// Cold-start poison: stale steering that makes the NEXT session start in the
// wrong world. This scanner knows what stale steering looks like — it does NOT
// know what any particular workspace is. Generic ratchet-state checks always
// run; project-specific operator surfaces (goal files, decision sheets) are an
// opt-in adapter declared in .ratchet/cold-start.json. No workspace path is
// ever hardcoded here.

function loadConfig(cwd) {
  const p = path.join(cwd, '.ratchet', 'cold-start.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_e) {
    return null; // no config → generic checks only
  }
}

// --- opt-in surface checks --------------------------------------------------
// A small registry so declared-but-unimplemented checks warn (transparent)
// rather than silently pass. Each returns { level: 'ok'|'warn'|'fail', detail }.

function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

const SURFACE_CHECKS = {
  'valid-as-of': ({ text }) => {
    const has = /valid[-\s]?as[-\s]?of|as of\s+\d{4}-\d{2}-\d{2}|updated:?\s*\d{4}-\d{2}-\d{2}/i.test(text);
    return has ? { level: 'ok' } : { level: 'warn', detail: 'no valid-as-of / date stamp — a reader cannot tell if it is current' };
  },
  'base-qualified-git': ({ text }) => {
    const offenders = [];
    for (const line of text.split('\n')) {
      const mentionsCount = /\b\d+\s+(ahead|behind)\b/i.test(line) || /\bahead of\b/i.test(line);
      if (!mentionsCount) continue;
      const named = /origin\/|upstream|@\{u\}|[\w.-]+\/[\w.-]+/.test(line); // a ref with a slash, or a known remote
      if (!named) offenders.push(line.trim());
    }
    return offenders.length
      ? { level: 'fail', detail: `unqualified git count: ${offenders.slice(0, 2).map((l) => `"${l}"`).join(', ')}` }
      : { level: 'ok' };
  },
  'no-retracted-claims': ({ text, retracted }) => {
    const hit = retracted.filter((a) => a.title && text.includes(a.title) && !/\[RETRACTED\]/i.test(text));
    return hit.length
      ? { level: 'fail', detail: `repeats retracted claim "${hit[0].title}" with no [RETRACTED] marker` }
      : { level: 'ok' };
  },
  'retracted-title': ({ text, file, cwd, retracted }) => {
    const rel = toPosix(path.relative(cwd, file));
    const match = retracted.find((a) => a.path && toPosix(a.path) === rel);
    if (!match) return { level: 'ok', detail: 'not a retracted artifact file' };
    const firstLine = text.split('\n').find((l) => l.trim()) || '';
    return /\[RETRACTED\]/i.test(firstLine)
      ? { level: 'ok' }
      : { level: 'fail', detail: 'retracted artifact file does not start with [RETRACTED]' };
  },
  'supersession-link': ({ text, file, cwd, retracted }) => {
    const rel = toPosix(path.relative(cwd, file));
    const match = retracted.find((a) => a.path && toPosix(a.path) === rel);
    const by = match && match.retracted && match.retracted.supersededBy;
    if (!by) return { level: 'ok' };
    return text.includes(by) ? { level: 'ok' } : { level: 'warn', detail: `does not link its superseder ${by}` };
  },
};

function globToRegex(glob) {
  let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  re = re.replace(/\\\*\\\*\//g, '(?:.*/)?').replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*').replace(/\\\?/g, '[^/]');
  return new RegExp('^' + re + '$');
}

function globFiles(cwd, glob) {
  const re = globToRegex(glob);
  const SKIP = new Set(['node_modules', '.git', '.ratchet', '.hg', 'dist', 'build', 'coverage']);
  const out = [];
  const stack = ['.'];
  let count = 0;
  while (stack.length && count < 5000) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(cwd, rel), { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    for (const e of entries) {
      const childRel = rel === '.' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(childRel);
      } else if (e.isFile()) {
        count++;
        if (re.test(toPosix(childRel))) out.push(path.join(cwd, childRel));
      }
    }
  }
  return out;
}

function resolveSurface(cwd, surface) {
  if (surface.path) {
    const p = path.resolve(cwd, surface.path);
    return fs.existsSync(p) && fs.statSync(p).isFile() ? [p] : [];
  }
  if (surface.glob) return globFiles(cwd, surface.glob);
  return [];
}

function runSurfaceChecks(cwd, file, surface, retracted, add) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    add(`${path.relative(cwd, file)}`, 'warn', 'surface unreadable');
    return;
  }
  const rel = path.relative(cwd, file);
  const ctx = { text, file, cwd, retracted };
  for (const checkName of surface.checks || []) {
    const fn = SURFACE_CHECKS[checkName];
    if (!fn) {
      add(`${rel} · ${checkName}`, 'warn', 'check declared but not implemented in this version (not silently skipped)');
      continue;
    }
    const res = fn(ctx);
    add(`${rel} · ${checkName}`, res.level, res.detail);
  }
}

// --- scanner ----------------------------------------------------------------

function scan(cwd = process.cwd()) {
  const checks = [];
  const add = (name, level, detail) => checks.push({ name, level, detail: detail || '' });
  const s = state.loadState(cwd);
  const artifacts = s.artifacts || [];
  const retracted = artifacts.filter((a) => a.status === 'retracted' || a.status === 'superseded');

  // Generic ratchet-state checks (always run) --------------------------------
  if (s.objective && String(s.objective).trim()) add('objective is set', 'ok');
  else add('objective is set', 'warn', 'no locked objective — a cold session starts without a target');

  const nextAction = String(s.nextAction || '').trim();
  if (nextAction) add('next action is set', 'ok');
  else add('next action is set', 'warn', 'no next action — a cold session has no first move');

  const lastArtifact = artifacts[artifacts.length - 1];
  if (lastArtifact && (lastArtifact.status === 'retracted' || lastArtifact.status === 'superseded')) {
    add('steering artifact is live', 'fail',
      `the most recent artifact "${lastArtifact.title}" is ${lastArtifact.status} — it will steer the next session toward dead work`);
  } else {
    add('steering artifact is live', 'ok');
  }

  const steeredToDead = retracted.filter(
    (a) => nextAction && (nextAction.includes(a.id) || (a.title && nextAction.includes(a.title)))
  );
  if (steeredToDead.length) {
    add('next action avoids retracted work', 'fail',
      `next action references ${steeredToDead.map((a) => a.id).join(', ')} which is retracted/superseded`);
  } else {
    add('next action avoids retracted work', 'ok');
  }

  const retractedIds = new Set(retracted.map((a) => a.id));
  const staleDefects = (s.defects || []).filter((d) => scoring.isDefectOpen(d) && d.artifact && retractedIds.has(d.artifact));
  if (staleDefects.length) {
    add('active defects have live premises', 'fail',
      `${staleDefects.length} open defect(s) attach to a retracted/superseded artifact — their premise may be gone`);
  } else {
    add('active defects have live premises', 'ok');
  }

  // Opt-in project-surface checks (adapter) ----------------------------------
  const config = loadConfig(cwd);
  if (config && Array.isArray(config.surfaces)) {
    for (const surface of config.surfaces) {
      const files = resolveSurface(cwd, surface);
      if (!files.length) {
        add(`surface ${surface.path || surface.glob}`, 'warn', 'configured but no matching file found');
        continue;
      }
      for (const file of files) runSurfaceChecks(cwd, file, surface, retracted, add);
    }
  }

  const ok = !checks.some((c) => c.level === 'fail');
  return { ok, configured: Boolean(config), checks };
}

module.exports = { scan, SURFACE_CHECKS, loadConfig };
