'use strict';

// Default document shapes + light validation. No external deps.

const STATE_VERSION = 1;
const LEDGER_VERSION = 1;

function nowIso(clock) {
  // Clock is injected so callers (and tests) can control time.
  // process.env.RATCHET_NOW lets hooks stamp deterministically if needed.
  if (clock) return clock;
  if (process.env.RATCHET_NOW) return process.env.RATCHET_NOW;
  return new Date().toISOString();
}

function newState(clock) {
  const t = nowIso(clock);
  return {
    version: STATE_VERSION,
    createdAt: t,
    updatedAt: t,
    title: '',
    objective: '',
    bottleneck: '',
    phase: 'idle', // idle | lock | auction | cut | build | attack | patch | compile
    dirty: false,
    lastCompileAt: null,
    confidence: null,
    nextAction: '',
    nextCommand: '',
    tags: [],
    decisions: [], // { id, at, choice, rejected, tripwire }
    artifacts: [], // { id, at, kind, title, path, status, holes }
    defects: [], // { id, at, severity, summary, status }
    assumptions: [], // { id, at, text, killTest, status }
    openLoops: [], // { id, at, text, status }
    touchedFiles: [], // { path, at }
    history: [], // { id, at, event, note }
  };
}

function newLedger(clock) {
  const t = nowIso(clock);
  return {
    version: LEDGER_VERSION,
    createdAt: t,
    updatedAt: t,
    features: [], // { id, name, area, workflow, routes, status }
    tests: [], // { id, feature, name, kind, status, lastRun }
    defects: [], // { id, feature, severity, summary, status, foundAt }
  };
}

// Collections that `state append` accepts, mapped to their id prefix.
const STATE_COLLECTIONS = {
  decisions: 'dec',
  artifacts: 'art',
  defects: 'def',
  assumptions: 'asm',
  openLoops: 'loop',
  touchedFiles: 'file',
  history: 'hist',
};

// Top-level scalar fields that `state set` accepts.
const STATE_SCALARS = new Set([
  'title',
  'objective',
  'bottleneck',
  'phase',
  'nextAction',
  'nextCommand',
  'confidence',
  'dirty',
  'lastCompileAt',
]);

const LEDGER_COLLECTIONS = {
  features: 'feat',
  tests: 'test',
  defects: 'ldef',
};

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const PHASES = ['idle', 'lock', 'auction', 'cut', 'build', 'attack', 'patch', 'compile', 'loop'];

module.exports = {
  STATE_VERSION,
  LEDGER_VERSION,
  nowIso,
  newState,
  newLedger,
  STATE_COLLECTIONS,
  STATE_SCALARS,
  LEDGER_COLLECTIONS,
  SEVERITIES,
  PHASES,
};
