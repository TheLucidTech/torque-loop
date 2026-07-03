'use strict';

// Shapes + constants for the evolution loop. The model drives the reasoning;
// these keep the record deterministic.

const PRESSURES = [
  'clarity',
  'correctness',
  'testability',
  'brevity',
  'specificity',
  'robustness',
  'user-friction',
  'security',
  'maintainability',
  'novelty',
  'conversion',
];

const MODES = ['code', 'prompt', 'docs', 'workflow', 'auto'];
const VERDICTS = ['KEEP', 'REVERT', 'ASK'];

function nowIso() {
  if (process.env.RATCHET_NOW) return process.env.RATCHET_NOW;
  return new Date().toISOString();
}

// One line of .ratchet/evolve-log.jsonl.
function newEvent(f = {}) {
  return {
    id: f.id || null,
    target: f.target || '',
    goal: f.goal || '',
    iteration: f.iteration != null ? f.iteration : 1,
    pressure: {
      primary: f.pressure?.primary || (f.primary || ''),
      secondary: f.pressure?.secondary || (f.secondary || ''),
    },
    chosenMutation: f.chosenMutation || '',
    filesTouched: Array.isArray(f.filesTouched) ? f.filesTouched : [],
    verification: {
      commands: f.verification?.commands || [],
      manualChecks: f.verification?.manualChecks || [],
      result: f.verification?.result || 'manual', // pass | fail | manual
    },
    verdict: VERDICTS.includes(f.verdict) ? f.verdict : 'ASK',
    remainingRisks: Array.isArray(f.remainingRisks) ? f.remainingRisks : [],
    nextEdge: f.nextEdge || '',
    timestamp: f.timestamp || nowIso(),
  };
}

// The proof gate. "No proof → no keep": a KEEP verdict may only be recorded when
// verification actually produced evidence and did not fail. REVERT and ASK are
// exempt — they exist precisely to record the absence of a proven improvement.
// Throws (does not return a boolean) so a bad KEEP can never be silently written.
function validateKeepGate(event) {
  if (!event || event.verdict !== 'KEEP') return event;
  const v = event.verification || {};
  const result = v.result;
  const commands = Array.isArray(v.commands) ? v.commands : [];
  const manualChecks = Array.isArray(v.manualChecks) ? v.manualChecks : [];

  if (result === 'fail') {
    throw new Error('cannot KEEP: verification failed');
  }
  if (!commands.length && !manualChecks.length) {
    throw new Error('cannot KEEP: no verification evidence');
  }
  if (result === 'manual' && !manualChecks.length) {
    throw new Error('cannot KEEP: manual verification requires explicit checks');
  }
  return event;
}

module.exports = { PRESSURES, MODES, VERDICTS, nowIso, newEvent, validateKeepGate };
