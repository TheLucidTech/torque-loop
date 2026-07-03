'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const schemas = require('./schemas');

// ---------------------------------------------------------------------------
// Location. State survives plugin updates when CLAUDE_PLUGIN_DATA is set.
// Everything is scoped per-project so multiple repos never collide in one
// shared plugin data directory.
// ---------------------------------------------------------------------------

function baseDir() {
  const explicit = process.env.RATCHET_DATA_DIR || process.env.CLAUDE_PLUGIN_DATA;
  if (explicit && explicit.trim()) return explicit.trim();
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, '.ratchet');
}

function projectSlug(cwd) {
  const root = cwd || process.cwd();
  const name = path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
  const hash = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 8);
  return `${name}-${hash}`;
}

function projectDir(cwd) {
  return path.join(baseDir(), 'projects', projectSlug(cwd));
}

function statePath(cwd) {
  return path.join(projectDir(cwd), 'state.json');
}

function ledgerPath(cwd) {
  return path.join(projectDir(cwd), 'ledger.json');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Read / write JSON safely.
// ---------------------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// Preserve, never silently lose. A tool whose promise is persistent state must
// not throw away a malformed file — a bad write or a manual edit could corrupt
// it. Missing/empty → fresh (quiet). Malformed → copy the bad bytes to
// <file>.corrupt.<timestamp>.json, warn, then let the caller reinitialize.
function backupCorrupt(file, raw) {
  try {
    const stamp = schemas.nowIso().replace(/[:.]/g, '-');
    const dest = `${file}.corrupt.${stamp}.json`;
    fs.writeFileSync(dest, raw, 'utf8');
    process.stderr.write(
      `[ratchet] ${path.basename(file)} was malformed — backed up to ${path.basename(dest)} and reinitialized.\n`
    );
    return dest;
  } catch (_e) {
    return null; // best effort; never block the session over a backup
  }
}

function readJsonResilient(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null; // missing / unreadable → caller creates fresh
  }
  if (!raw.trim()) return null; // empty file → fresh, no noisy backup
  try {
    return JSON.parse(raw);
  } catch (_e) {
    backupCorrupt(file, raw);
    return null;
  }
}

// ---------------------------------------------------------------------------
// State lifecycle.
// ---------------------------------------------------------------------------

function initProject(cwd, { force = false } = {}) {
  ensureDir(projectDir(cwd));
  const sPath = statePath(cwd);
  const lPath = ledgerPath(cwd);
  let created = false;
  if (force || !fs.existsSync(sPath)) {
    writeJson(sPath, schemas.newState());
    created = true;
  }
  if (force || !fs.existsSync(lPath)) {
    writeJson(lPath, schemas.newLedger());
  }
  return { dir: projectDir(cwd), created, statePath: sPath, ledgerPath: lPath };
}

function loadState(cwd) {
  const existing = readJsonResilient(statePath(cwd));
  if (existing) return existing;
  // Auto-init on first read so skills never hit a missing file. A corrupt file
  // has already been backed up by readJsonResilient before we overwrite it.
  const fresh = schemas.newState();
  writeJson(statePath(cwd), fresh);
  return fresh;
}

function saveState(cwd, state) {
  state.updatedAt = schemas.nowIso();
  writeJson(statePath(cwd), state);
  return state;
}

function loadLedger(cwd) {
  const existing = readJsonResilient(ledgerPath(cwd));
  if (existing) return existing;
  const fresh = schemas.newLedger();
  writeJson(ledgerPath(cwd), fresh);
  return fresh;
}

function saveLedger(cwd, ledger) {
  ledger.updatedAt = schemas.nowIso();
  writeJson(ledgerPath(cwd), ledger);
  return ledger;
}

// Short, sortable, collision-resistant id: <prefix>-<time36>-<rand>
let _counter = 0;
function makeId(prefix) {
  _counter = (_counter + 1) % 1000;
  const t = Date.now().toString(36);
  const c = _counter.toString(36).padStart(2, '0');
  return `${prefix || 'id'}-${t}${c}`;
}

module.exports = {
  baseDir,
  projectSlug,
  projectDir,
  statePath,
  ledgerPath,
  ensureDir,
  readJson,
  writeJson,
  initProject,
  loadState,
  saveState,
  loadLedger,
  saveLedger,
  makeId,
};
