'use strict';

const { PRESSURES } = require('./schema');

// Pressure selection is ultimately the model's call. This helper only maps a
// mode to the pressures that most often matter for it, so the SKILL has a
// sane starting menu and rejects the tempting-but-wrong vector on purpose.

const MODE_PRESSURES = {
  code: ['correctness', 'testability', 'robustness', 'maintainability', 'security'],
  prompt: ['specificity', 'testability', 'robustness', 'clarity'],
  docs: ['clarity', 'specificity', 'user-friction', 'brevity'],
  workflow: ['correctness', 'robustness', 'maintainability'],
};

// The pressure most likely to tempt a rewrite instead of a delta, per mode.
const REWRITE_TRAP = {
  code: 'novelty',
  prompt: 'novelty',
  docs: 'novelty',
  workflow: 'novelty',
};

function suggest(mode) {
  const m = MODE_PRESSURES[mode] ? mode : 'code';
  return {
    mode: m,
    primaryCandidates: MODE_PRESSURES[m],
    avoid: REWRITE_TRAP[m],
    all: PRESSURES,
  };
}

module.exports = { suggest, MODE_PRESSURES };
