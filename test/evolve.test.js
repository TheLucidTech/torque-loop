'use strict';

// Zero-dependency smoke test for the evolve helpers. Run: node test/evolve.test.js
// Uses an isolated temp log so it never touches a real .ratchet/ dir.

const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const tmp = path.join(os.tmpdir(), 'ratchet-evolve-test-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
process.env.RATCHET_EVOLVE_LOG = path.join(tmp, 'evolve-log.jsonl');
process.env.RATCHET_NOW = '2026-07-03T00:00:00.000Z';

const snapshot = require('../src/evolve/snapshot');
const score = require('../src/evolve/score');
const verify = require('../src/evolve/verify');
const journal = require('../src/evolve/journal');
const pressure = require('../src/evolve/pressure');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  ok  ${name}\n`);
}

ok('mode detection by extension', () => {
  assert.strictEqual(snapshot.detectMode('src/auth/session.js'), 'code');
  assert.strictEqual(snapshot.detectMode('README.md'), 'docs');
  assert.strictEqual(snapshot.detectMode('skills/x/SKILL.md'), 'prompt');
  assert.strictEqual(snapshot.detectMode('hooks/hooks.json'), 'workflow');
});

ok('snapshot hashes an existing file + non-file goal', () => {
  const f = path.join(tmp, 'artifact.txt');
  fs.writeFileSync(f, 'hello');
  const s1 = snapshot.snapshot({ target: f, mode: 'auto' });
  assert.strictEqual(s1.exists, true);
  assert.strictEqual(s1.bytes, 5);
  assert.ok(/^[0-9a-f]{64}$/.test(s1.baselineHash));

  const s2 = snapshot.snapshot({ target: 'a-feature-not-a-file', goal: 'x', mode: 'code' });
  assert.strictEqual(s2.exists, false);
  assert.ok(/^[0-9a-f]{64}$/.test(s2.baselineHash), 'hashes the goal when no file');
});

ok('mutation scoring picks the highest and ranks', () => {
  const r = score.scoreAndChoose([
    { name: 'weak', impact: 1, evidence: 1, reversibility: 1, goalFit: 1, risk: 5, complexity: 5 },
    { name: 'strong', impact: 5, evidence: 5, reversibility: 5, goalFit: 5, risk: 1, complexity: 1 },
  ]);
  assert.strictEqual(r.chosen.name, 'strong');
  assert.strictEqual(r.chosen.score, 5 * 5 * 5 * 5 - 1 - 1); // 623
  assert.strictEqual(r.mutations[1].score, 1 - 5 - 5); // -9
  assert.strictEqual(r.chosen.rank, 1);
});

ok('score rejects empty / non-array', () => {
  assert.throws(() => score.scoreAndChoose([]), /non-empty/);
  assert.throws(() => score.scoreAndChoose('nope'), /array/);
});

ok('verify runs a passing command', () => {
  const v = verify.verify({ target: 't', testCommand: process.platform === 'win32' ? 'cmd /c exit 0' : 'true', mode: 'code' });
  assert.strictEqual(v.result, 'pass');
  assert.strictEqual(v.commands[0].pass, true);
});

ok('verify reports a failing command', () => {
  const v = verify.verify({ target: 't', testCommand: process.platform === 'win32' ? 'cmd /c exit 1' : 'false', mode: 'code' });
  assert.strictEqual(v.result, 'fail');
  assert.strictEqual(v.commands[0].pass, false);
});

ok('verify without a command returns manual checks', () => {
  const v = verify.verify({ target: 't', mode: 'prompt' });
  assert.strictEqual(v.result, 'manual');
  assert.ok(v.manualChecks.length >= 2);
});

ok('journal appends events with dated ids and status', () => {
  const e1 = journal.appendEvent(process.cwd(), { target: 'a.md', verdict: 'KEEP', nextEdge: 'do x' });
  assert.strictEqual(e1.id, 'evo_2026_07_03_001');
  const e2 = journal.appendEvent(process.cwd(), { target: 'a.md', verdict: 'REVERT' });
  assert.strictEqual(e2.id, 'evo_2026_07_03_002');
  const s = journal.status(process.cwd());
  assert.strictEqual(s.events, 2);
  assert.strictEqual(s.kept, 1);
  assert.strictEqual(s.reverted, 1);
  assert.strictEqual(s.last.verdict, 'REVERT');
});

ok('pressure suggests a vector and flags the rewrite trap', () => {
  const p = pressure.suggest('docs');
  assert.ok(p.primaryCandidates.includes('clarity'));
  assert.strictEqual(p.avoid, 'novelty');
});

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`\n${passed} passed\n`);
