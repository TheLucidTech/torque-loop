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
  for (const d of ['.claude-plugin', '.github', '.git', 'node_modules', 'src']) {
    fs.mkdirSync(path.join(proj, d), { recursive: true });
  }
  const snap = repo.snapshot(proj);
  assert.ok(snap.dirs.includes('.claude-plugin'), '.claude-plugin is visible');
  assert.ok(snap.dirs.includes('.github'), '.github is visible');
  assert.ok(!snap.dirs.includes('.git'), '.git is skipped');
  assert.ok(!snap.dirs.includes('node_modules'), 'node_modules is skipped');
});

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`\n${passed} passed\n`);
