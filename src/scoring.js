'use strict';

// Scoring is deliberately transparent: the model can reproduce it by hand.
// No hidden weighting, no ML — just multiplicative pressure functions.

const schemas = require('./schemas');

// One predicate, one source of truth. Confidence, the state summary, and the
// QA ledger all decide "is this defect still draining?" the same way — so a
// resolved/waived/superseded defect can never lie on one surface while it drains
// on another. Terminal statuses are read from schemas so the lifecycle verbs
// and the scorer can never disagree about what "done" means.
const TERMINAL_DEFECT_STATUSES = new Set(schemas.DEFECT_TERMINAL_STATUSES.map((s) => s.toLowerCase()));
function isDefectOpen(defect) {
  const status = String((defect && defect.status) || 'open').toLowerCase();
  return !TERMINAL_DEFECT_STATUSES.has(status);
}

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
  const openDefects = (state.defects || []).filter(isDefectOpen);
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

  const holey = (state.artifacts || []).filter(
    (a) => a.status !== 'retracted' && Array.isArray(a.holes) && a.holes.length > 0
  );
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

// ---------------------------------------------------------------------------
// Aperture (0.4). The dial that meters how much of the loop to run. Score five
// uncertainty dimensions 0..2, sum to 0..10, map to A0..A4, and emit the ratchet
// skill sequence to run at that depth. The point is anti-ceremony: spend the
// full loop only when uncertainty earns it; snap when it doesn't.
//   ambiguity     : are goals / acceptance criteria / constraints unclear?
//   terrain       : is the codebase / domain / tooling unfamiliar?
//   taste         : would the user recognize the right answer only once shown?
//   blastRadius   : could it hit data, security, production, many files/users?
//   reversibility : is the change hard to undo or validate?
// ---------------------------------------------------------------------------

const APERTURE_DIMENSIONS = ['ambiguity', 'terrain', 'taste', 'blastRadius', 'reversibility'];

const APERTURE_LEVELS = [
  { max: 2, level: 'A0', name: 'Snap', implement: true, sequence: ['build', 'verify'] },
  { max: 4, level: 'A1', name: 'Narrow', implement: true, sequence: ['lock', 'build', 'verify', 'compile'] },
  { max: 6, level: 'A2', name: 'Working', implement: true, sequence: ['lock', 'cut', 'build', 'attack', 'patch', 'verify', 'compile'] },
  { max: 8, level: 'A3', name: 'Wide', implement: true, sequence: ['lock', 'auction', 'cut', 'decide', 'build', 'attack', 'patch', 'compile'] },
  { max: 10, level: 'A4', name: 'Max', implement: false, sequence: ['lock', 'cut', 'decide'] },
];

// A missing dimension defaults to 1 (neutral), never 0 — treating unknown
// uncertainty as "certain" would under-open the aperture, the exact failure the
// dial exists to prevent.
function apertureDim(dims, key) {
  const v = dims ? dims[key] : undefined;
  return v == null ? 1 : clamp(v, 0, 2);
}

function scoreAperture(dims) {
  if (dims == null || typeof dims !== 'object' || Array.isArray(dims)) {
    throw new Error(
      'aperture expects a JSON object of dimensions (ambiguity, terrain, taste, blastRadius, reversibility), each 0-2'
    );
  }
  const scored = {};
  let total = 0;
  for (const key of APERTURE_DIMENSIONS) {
    const v = apertureDim(dims, key);
    scored[key] = v;
    total += v;
  }
  const band = APERTURE_LEVELS.find((b) => total <= b.max) || APERTURE_LEVELS[APERTURE_LEVELS.length - 1];
  return {
    score: total, // 0..10
    level: band.level, // A0..A4
    name: band.name,
    implement: band.implement, // A4: do NOT build until constraints are locked
    sequence: band.sequence.slice(), // ratchet skills to run at this depth
    dimensions: scored,
  };
}

module.exports = {
  scoreFriction,
  scoreConfidence,
  scoreAperture,
  clamp,
  isDefectOpen,
  TERMINAL_DEFECT_STATUSES,
  APERTURE_DIMENSIONS,
  APERTURE_LEVELS,
};
