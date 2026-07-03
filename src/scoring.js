'use strict';

// Scoring is deliberately transparent: the model can reproduce it by hand.
// No hidden weighting, no ML — just multiplicative pressure functions.

function clamp(n, lo, hi) {
  n = Number(n);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// Friction auction (canonical "Friction Auction" prompt).
//   Priority = Leverage x Certainty x Time-to-unblock x Risk
// Each factor is 1..10. Higher priority = attack this bottleneck first.
//   leverage : how much unblocking this frees up downstream (10 = unblocks all)
//   certainty: how sure we are it is actually the blocker (10 = proven)
//   speed    : time-to-unblock, where 10 = fast to clear, 1 = slow grind
//   risk     : cost of ignoring it (10 = the whole thing fails if left)
// ---------------------------------------------------------------------------

function scoreFriction(obstacles) {
  if (!Array.isArray(obstacles)) {
    throw new Error('friction expects a JSON array of obstacles');
  }
  const scored = obstacles.map((o, i) => {
    const leverage = clamp(o.leverage, 1, 10);
    const certainty = clamp(o.certainty, 1, 10);
    const speed = clamp(o.speed != null ? o.speed : o.timeToUnblock, 1, 10);
    const risk = clamp(o.risk != null ? o.risk : o.riskOfIgnoring, 1, 10);
    const priority = leverage * certainty * speed * risk;
    return {
      rank: 0,
      name: o.name || o.obstacle || `obstacle-${i + 1}`,
      leverage,
      certainty,
      speed,
      risk,
      priority, // 1..10000
      note: o.note || '',
    };
  });
  scored.sort((a, b) => b.priority - a.priority);
  scored.forEach((s, i) => (s.rank = i + 1));
  const winner = scored[0] || null;
  const runnerUp = scored[1] || null;
  return {
    obstacles: scored,
    winner,
    runnerUp,
    margin: winner && runnerUp ? winner.priority - runnerUp.priority : null,
  };
}

// ---------------------------------------------------------------------------
// Confidence. Starts at 100, drained by unresolved pressure. Never below 0.
// This is the loop's stop condition: high confidence + zero critical debt.
// ---------------------------------------------------------------------------

function scoreConfidence(state) {
  const penalties = [];
  const openDefects = (state.defects || []).filter((d) => d.status !== 'resolved' && d.status !== 'closed');
  const bySev = (sev) => openDefects.filter((d) => (d.severity || 'medium').toLowerCase() === sev);

  const critical = bySev('critical');
  const high = bySev('high');
  const medium = bySev('medium');
  const low = bySev('low');

  if (critical.length) penalties.push({ reason: `${critical.length} open critical defect(s)`, cost: 40 * critical.length });
  if (high.length) penalties.push({ reason: `${high.length} open high defect(s)`, cost: 20 * high.length });
  if (medium.length) penalties.push({ reason: `${medium.length} open medium defect(s)`, cost: 8 * medium.length });
  if (low.length) penalties.push({ reason: `${low.length} open low defect(s)`, cost: 2 * low.length });

  const untested = (state.assumptions || []).filter((a) => a.status !== 'tested' && a.status !== 'killed');
  if (untested.length) penalties.push({ reason: `${untested.length} untested assumption(s)`, cost: 10 * untested.length });

  const holey = (state.artifacts || []).filter((a) => Array.isArray(a.holes) && a.holes.length > 0);
  if (holey.length) penalties.push({ reason: `${holey.length} artifact(s) with known holes`, cost: 6 * holey.length });

  const openLoops = (state.openLoops || []).filter((l) => l.status !== 'closed');
  if (openLoops.length) penalties.push({ reason: `${openLoops.length} open loop(s)`, cost: 3 * openLoops.length });

  if (!state.nextAction || !String(state.nextAction).trim()) {
    penalties.push({ reason: 'no defined next action', cost: 10 });
  }
  if (!state.objective || !String(state.objective).trim()) {
    penalties.push({ reason: 'no locked objective', cost: 15 });
  }

  const totalCost = penalties.reduce((s, p) => s + p.cost, 0);
  const score = Math.max(0, 100 - totalCost);

  let band = 'blocked';
  if (score >= 85) band = 'ship-ready';
  else if (score >= 65) band = 'converging';
  else if (score >= 40) band = 'contested';
  else if (score >= 20) band = 'fragile';

  // The loop may stop only when no critical/high debt remains AND nothing
  // core is untested AND there is a next action.
  const loopClear =
    critical.length === 0 &&
    high.length === 0 &&
    untested.length === 0 &&
    Boolean(state.nextAction && String(state.nextAction).trim());

  return { score, band, loopClear, penalties, openDefects: openDefects.length };
}

module.exports = { scoreFriction, scoreConfidence, clamp };
