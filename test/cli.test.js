'use strict';

// Zero-dependency smoke test. Run: node test/cli.test.js
// Uses an isolated temp data dir so it never touches real state.

const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const tmp = path.join(os.tmpdir(), 'ratchet-test-' + process.pid);
process.env.RATCHET_DATA_DIR = tmp;
fs.rmSync(tmp, { recursive: true, force: true });

const state = require('../src/state');
const scoring = require('../src/scoring');
const artifacts = require('../src/artifacts');
const ledger = require('../src/ledger');
const md = require('../src/markdown');
const repo = require('../src/repoSnapshot');
const gitRefs = require('../src/gitRefs');
const coldStart = require('../src/coldStart');
const cli = require('../src/cli');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  ok  ${name}\n`);
}

const cwd = process.cwd();

ok('init creates state + ledger', () => {
  const res = state.initProject(cwd, { force: true });
  assert.ok(fs.existsSync(res.statePath), 'state.json exists');
  assert.ok(fs.existsSync(res.ledgerPath), 'ledger.json exists');
});

ok('state set + get round-trips', () => {
  const s = state.loadState(cwd);
  s.objective = 'ship it';
  state.saveState(cwd, s);
  assert.strictEqual(state.loadState(cwd).objective, 'ship it');
});

ok('artifact add flips dirty and records', () => {
  const rec = artifacts.addArtifact(cwd, { title: 'core', kind: 'code', holes: ['no tests'] });
  assert.strictEqual(rec.title, 'core');
  assert.strictEqual(state.loadState(cwd).dirty, true);
});

ok('defect add hits both state and ledger', () => {
  const res = artifacts.addDefect(cwd, { severity: 'high', summary: 'boom' });
  assert.strictEqual(res.state.severity, 'high');
  assert.ok(res.ledger, 'ledger record created');
  assert.strictEqual(ledger.summary(state.loadLedger(cwd)).openDefects, 1);
});

// --- defect lifecycle (0.3 Seam Gate) ---------------------------------------

ok('defect resolve requires evidence (proof gate)', () => {
  const { state: d } = artifacts.addDefect(cwd, { severity: 'high', summary: 'needs proof' });
  assert.throws(() => cli.run(['node', 'ratchet', 'defect', 'resolve', d.id]), /evidence/);
  assert.strictEqual(state.loadState(cwd).defects.find((x) => x.id === d.id).status, 'open', 'stays open without proof');
});

ok('defect resolve with evidence clears the confidence drain', () => {
  const { state: d } = artifacts.addDefect(cwd, { severity: 'critical', summary: 'blocker' });
  const before = scoring.scoreConfidence(state.loadState(cwd)).score;
  cli.run(['node', 'ratchet', 'defect', 'resolve', d.id, '--evidence', 'ran the repro, now green']);
  const after = state.loadState(cwd).defects.find((x) => x.id === d.id);
  assert.strictEqual(after.status, 'resolved');
  assert.ok(/green/.test(after.evidence), 'resolution evidence is recorded');
  assert.ok(scoring.scoreConfidence(state.loadState(cwd)).score > before, 'resolving raises confidence');
});

ok('defect waive stops the drain (the case the 0.2 scorer was blind to)', () => {
  const { state: d } = artifacts.addDefect(cwd, { severity: 'critical', summary: 'accepted risk' });
  const before = scoring.scoreConfidence(state.loadState(cwd)).score;
  cli.run(['node', 'ratchet', 'defect', 'waive', d.id, '--owner', 'danny', '--reason', 'out of scope this release']);
  const after = state.loadState(cwd).defects.find((x) => x.id === d.id);
  assert.strictEqual(after.status, 'waived');
  assert.strictEqual(after.waivedBy, 'danny');
  assert.ok(scoring.scoreConfidence(state.loadState(cwd)).score > before, 'waiving stops the drain');
});

ok('defect waive requires both owner and reason', () => {
  const { state: d } = artifacts.addDefect(cwd, { severity: 'low', summary: 'nit' });
  assert.throws(() => cli.run(['node', 'ratchet', 'defect', 'waive', d.id, '--reason', 'x']), /owner/);
  assert.throws(() => cli.run(['node', 'ratchet', 'defect', 'waive', d.id, '--owner', 'danny']), /reason/);
});

ok('defect supersede stops the drain and records the replacement', () => {
  const { state: d } = artifacts.addDefect(cwd, { severity: 'high', summary: 'old premise' });
  const before = scoring.scoreConfidence(state.loadState(cwd)).score;
  cli.run(['node', 'ratchet', 'defect', 'supersede', d.id, '--by', 'art_live_seam_eval']);
  const after = state.loadState(cwd).defects.find((x) => x.id === d.id);
  assert.strictEqual(after.status, 'superseded');
  assert.strictEqual(after.supersededBy, 'art_live_seam_eval');
  assert.ok(scoring.scoreConfidence(state.loadState(cwd)).score > before);
});

ok('defect reopen re-drains a resolved defect', () => {
  const { state: d } = artifacts.addDefect(cwd, { severity: 'high', summary: 'flaky' });
  cli.run(['node', 'ratchet', 'defect', 'resolve', d.id, '--evidence', 'passed 100x']);
  const mid = scoring.scoreConfidence(state.loadState(cwd)).score;
  cli.run(['node', 'ratchet', 'defect', 'reopen', d.id, '--reason', 'regressed on CI']);
  assert.strictEqual(state.loadState(cwd).defects.find((x) => x.id === d.id).status, 'reopened');
  assert.ok(scoring.scoreConfidence(state.loadState(cwd)).score < mid, 'reopen re-drains confidence');
});

ok('resolving a defect syncs its ledger mirror', () => {
  const { state: d } = artifacts.addDefect(cwd, { severity: 'high', summary: 'mirror me', feature: 'router' });
  assert.ok(d.ledgerId, 'state defect links to its ledger mirror');
  cli.run(['node', 'ratchet', 'defect', 'resolve', d.id, '--evidence', 'fixed + verified live']);
  const mirror = state.loadLedger(cwd).defects.find((x) => x.id === d.ledgerId);
  assert.strictEqual(mirror.status, 'resolved', 'ledger mirror follows the state transition');
});

ok('defect list + get render without throwing', () => {
  const listOut = md.defectList(state.loadState(cwd).defects);
  assert.ok(/Defects/.test(listOut));
  const one = state.loadState(cwd).defects[0];
  assert.ok(md.defectOne(one).includes(one.id));
});

// --- artifact retraction (0.3 Seam Gate) ------------------------------------

ok('retract flips status, keeps provenance, and stops holes draining confidence', () => {
  const a = artifacts.addArtifact(cwd, { title: 'T2.3 re-scope', kind: 'docs', holes: ['premise unverified'] });
  const before = scoring.scoreConfidence(state.loadState(cwd)).score;
  cli.run([
    'node', 'ratchet', 'retract', a.id,
    '--reason', 'central premise false: endpoint exists and returns live vectors',
    '--superseded-by', 'art_live_seam_eval',
  ]);
  const after = state.loadState(cwd).artifacts.find((x) => x.id === a.id);
  assert.strictEqual(after.status, 'retracted');
  assert.strictEqual(after.retracted.keptForProvenance, true);
  assert.strictEqual(after.retracted.supersededBy, 'art_live_seam_eval');
  assert.ok(scoring.scoreConfidence(state.loadState(cwd)).score >= before, 'a retracted holey artifact stops draining');
});

ok('retract requires a reason (no silent retraction)', () => {
  const a = artifacts.addArtifact(cwd, { title: 'x', kind: 'docs' });
  assert.throws(() => cli.run(['node', 'ratchet', 'retract', a.id]), /reason/);
});

ok('friction uses 1-10 scale and ranks', () => {
  const r = scoring.scoreFriction([
    { name: 'a', leverage: 10, certainty: 10, speed: 10, risk: 10 },
    { name: 'b', leverage: 1, certainty: 1, speed: 1, risk: 1 },
  ]);
  assert.strictEqual(r.winner.name, 'a');
  assert.strictEqual(r.winner.priority, 10000);
  assert.strictEqual(r.obstacles[1].priority, 1);
});

ok('friction clamps out-of-range input', () => {
  const r = scoring.scoreFriction([{ name: 'x', leverage: 99, certainty: 0, speed: -5, risk: 7 }]);
  const x = r.obstacles[0];
  assert.strictEqual(x.leverage, 10);
  assert.strictEqual(x.certainty, 1);
  assert.strictEqual(x.speed, 1);
  assert.strictEqual(x.risk, 7);
});

ok('confidence drains on open high defect + holes + no next action', () => {
  const c = scoring.scoreConfidence(state.loadState(cwd));
  assert.ok(c.score < 100, 'score is penalized');
  assert.strictEqual(c.loopClear, false, 'loop not clear with open high defect');
  assert.ok(c.penalties.some((p) => /high defect/.test(p.reason)));
});

ok('confidence is loop-clear when clean', () => {
  const clean = {
    objective: 'done',
    nextAction: 'ship',
    defects: [{ severity: 'high', status: 'resolved' }],
    assumptions: [{ text: 'x', status: 'tested' }],
    artifacts: [{ title: 'a', holes: [] }],
    openLoops: [],
  };
  const c = scoring.scoreConfidence(clean);
  assert.strictEqual(c.loopClear, true);
  assert.ok(c.score >= 85, `expected ship-ready, got ${c.score}`);
});

ok('friction rejects non-array', () => {
  assert.throws(() => scoring.scoreFriction({ not: 'an array' }), /array/);
});

ok('markdown render does not throw on populated state', () => {
  const out = md.stateSummary(state.loadState(cwd));
  assert.ok(out.includes('Ratchet state'));
  const exp = md.fullExport(state.loadState(cwd), state.loadLedger(cwd));
  assert.ok(exp.includes('Ratchet compile'));
});

ok('compile done clears dirty, stamps lastCompileAt, records history', () => {
  cli.run(['node', 'ratchet', 'touch', 'README.md']);
  assert.strictEqual(state.loadState(cwd).dirty, true, 'touch dirties state');
  cli.run(['node', 'ratchet', 'compile', 'done']);
  const s = state.loadState(cwd);
  assert.strictEqual(s.dirty, false, 'compile done clears dirty (Stop hook stays quiet)');
  assert.ok(s.lastCompileAt, 'lastCompileAt is stamped');
  assert.ok(s.history.some((h) => h.event === 'compile.done'), 'compile.done recorded in history');
});

ok('corrupt state.json is backed up, not silently lost', () => {
  const sp = state.statePath(cwd);
  state.initProject(cwd, { force: true });
  fs.writeFileSync(sp, '{ this is not valid json', 'utf8');
  const loaded = state.loadState(cwd); // triggers backup + fresh
  assert.ok(loaded && loaded.version, 'a fresh state is created');
  const dir = path.dirname(sp);
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt.'));
  assert.ok(backups.length >= 1, 'a corrupt backup exists');
  const raw = fs.readFileSync(path.join(dir, backups[0]), 'utf8');
  assert.ok(raw.includes('this is not valid json'), 'backup preserves the original bad bytes');
});

ok('corrupt ledger.json is backed up, not silently lost', () => {
  const lp = state.ledgerPath(cwd);
  fs.writeFileSync(lp, 'garbage{', 'utf8');
  const loaded = state.loadLedger(cwd);
  assert.ok(loaded && loaded.version, 'a fresh ledger is created');
  const backups = fs.readdirSync(path.dirname(lp)).filter((f) => f.startsWith('ledger.json.corrupt.'));
  assert.ok(backups.length >= 1, 'a corrupt ledger backup exists');
});

ok('repo snapshot sees allowlisted dot dirs, skips .git / node_modules', () => {
  const proj = path.join(tmp, 'snap-fixture');
  for (const d of ['.agents', '.claude-plugin', '.codex-plugin', '.github', '.git', 'node_modules', 'src']) {
    fs.mkdirSync(path.join(proj, d), { recursive: true });
  }
  const snap = repo.snapshot(proj);
  assert.ok(snap.dirs.includes('.agents'), '.agents is visible');
  assert.ok(snap.dirs.includes('.claude-plugin'), '.claude-plugin is visible');
  assert.ok(snap.dirs.includes('.codex-plugin'), '.codex-plugin is visible');
  assert.ok(snap.dirs.includes('.github'), '.github is visible');
  assert.ok(!snap.dirs.includes('.git'), '.git is skipped');
  assert.ok(!snap.dirs.includes('node_modules'), 'node_modules is skipped');
});

ok('git status-refs is base-qualified and never emits a bare count', () => {
  const refs = gitRefs.statusRefs(process.cwd());
  assert.strictEqual(typeof refs.isRepo, 'boolean');
  if (refs.isRepo) {
    assert.ok(Array.isArray(refs.comparisons), 'comparisons is an array');
    for (const c of refs.comparisons) {
      assert.ok(c.base, 'every comparison names its base ref');
      assert.strictEqual(typeof c.ahead, 'number');
      assert.strictEqual(typeof c.behind, 'number');
    }
  }
  const rendered = md.gitStatusRefs(refs);
  assert.ok(/Git status/.test(rendered));
  // A non-repo path renders cleanly, not a crash.
  assert.ok(/not a git repository/.test(md.gitStatusRefs({ isRepo: false })));
});

ok('cold-start scanner flags retracted steering + unqualified git counts', () => {
  const proj = path.join(tmp, 'cold-fixture');
  fs.mkdirSync(path.join(proj, '.ratchet'), { recursive: true });
  state.initProject(proj, { force: true });
  const st = state.loadState(proj);
  st.objective = 'ship seam gate';
  st.nextAction = 'finish art-dead re-scope';
  st.artifacts = [
    { id: 'art-dead', title: 'T2.3 re-scope', status: 'retracted', path: 'reports/rescope.md', retracted: { supersededBy: 'art-eval', keptForProvenance: true } },
  ];
  state.saveState(proj, st);
  // a goal surface: unqualified git count, no valid-as-of stamp, repeats the retracted claim
  fs.writeFileSync(path.join(proj, 'goal.md'), '# Goal\nWe are 43 ahead of main.\nT2.3 re-scope is still the plan.\n');
  fs.writeFileSync(
    path.join(proj, '.ratchet', 'cold-start.json'),
    JSON.stringify({ surfaces: [{ path: 'goal.md', kind: 'goal', checks: ['base-qualified-git', 'valid-as-of', 'no-retracted-claims'] }] })
  );
  const r = coldStart.scan(proj);
  assert.strictEqual(r.ok, false, 'contradictions make the scan not-ok');
  const lvl = (frag) => (r.checks.find((c) => c.name.includes(frag)) || {}).level;
  assert.strictEqual(lvl('steering artifact is live'), 'fail');
  assert.strictEqual(lvl('next action avoids retracted'), 'fail');
  assert.strictEqual(lvl('base-qualified-git'), 'fail');
  assert.strictEqual(lvl('valid-as-of'), 'warn');
  assert.strictEqual(lvl('no-retracted-claims'), 'fail');
});

ok('cold-start scanner is clean on healthy state and flags unimplemented checks transparently', () => {
  const proj = path.join(tmp, 'cold-clean');
  fs.mkdirSync(path.join(proj, '.ratchet'), { recursive: true });
  state.initProject(proj, { force: true });
  const st = state.loadState(proj);
  st.objective = 'x';
  st.nextAction = 'do y';
  st.artifacts = [{ id: 'a1', title: 'live spec', status: 'v1', holes: [] }];
  state.saveState(proj, st);
  fs.writeFileSync(path.join(proj, 'sheet.md'), '# Sheet\nvalid-as-of 2026-07-03\n82 ahead of origin/main.\n');
  fs.writeFileSync(
    path.join(proj, '.ratchet', 'cold-start.json'),
    JSON.stringify({ surfaces: [{ path: 'sheet.md', kind: 'decision-sheet', checks: ['valid-as-of', 'base-qualified-git', 'no-closed-work-as-next'] }] })
  );
  const r = coldStart.scan(proj);
  assert.strictEqual(r.ok, true, 'healthy state + qualified counts pass');
  assert.strictEqual((r.checks.find((c) => c.name.includes('valid-as-of')) || {}).level, 'ok');
  assert.strictEqual((r.checks.find((c) => c.name.includes('base-qualified-git')) || {}).level, 'ok');
  // a declared-but-unimplemented check must warn, not silently pass
  assert.strictEqual((r.checks.find((c) => c.name.includes('no-closed-work-as-next')) || {}).level, 'warn');
});

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`\n${passed} passed\n`);
