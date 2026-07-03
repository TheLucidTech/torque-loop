'use strict';

// Mutation scoring — reproducible, no hidden weighting.
//   Score = Impact × Evidence × Reversibility × Goal-Fit − Risk − Complexity
// Each factor is 1..5. The command must pick exactly one mutation (no menu).

function clamp(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 1;
  return Math.max(1, Math.min(5, n));
}

function scoreOne(m, i) {
  const impact = clamp(m.impact);
  const evidence = clamp(m.evidence);
  const reversibility = clamp(m.reversibility);
  const goalFit = clamp(m.goalFit != null ? m.goalFit : m.goalfit);
  const risk = clamp(m.risk);
  const complexity = clamp(m.complexity);
  const score = impact * evidence * reversibility * goalFit - risk - complexity;
  return {
    rank: 0,
    name: m.name || m.mutation || `mutation-${i + 1}`,
    impact,
    evidence,
    reversibility,
    goalFit,
    risk,
    complexity,
    score, // range: -9 .. 623
    note: m.note || m.change || '',
  };
}

function scoreAndChoose(mutations) {
  if (!Array.isArray(mutations) || !mutations.length) {
    throw new Error('score expects a non-empty JSON array of mutation candidates');
  }
  const scored = mutations.map(scoreOne);
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.rank = i + 1));
  const chosen = scored[0];
  const runnerUp = scored[1] || null;
  return {
    mutations: scored,
    chosen,
    runnerUp,
    margin: runnerUp ? chosen.score - runnerUp.score : null,
  };
}

module.exports = { scoreAndChoose, scoreOne, clamp };
