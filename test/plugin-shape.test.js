'use strict';

// Zero-dependency plugin-shape test. Run: node test/plugin-shape.test.js
// Validates the packaging surface Claude Code and Codex expect — so a broken plugin
// package (missing SKILL.md, drifted version, stale command name) fails CI
// before a user ever installs it. Reads the real repo, writes nothing.

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const frontmatter = (text) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : null;
};

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  ok  ${name}\n`);
}

const pkg = readJson('package.json');
const claudePlugin = readJson('.claude-plugin/plugin.json');
const claudeMarket = readJson('.claude-plugin/marketplace.json');
const codexPlugin = readJson('.codex-plugin/plugin.json');
const codexMarket = readJson('.agents/plugins/marketplace.json');

ok('manifests exist and parse', () => {
  assert.ok(pkg.version, 'package.json has a version');
  assert.ok(claudePlugin.version, 'Claude plugin.json has a version');
  assert.ok(claudeMarket.metadata && claudeMarket.metadata.version, 'Claude marketplace metadata has a version');
  assert.ok(Array.isArray(claudeMarket.plugins) && claudeMarket.plugins.length, 'Claude marketplace lists plugins');
  assert.ok(codexPlugin.version, 'Codex plugin.json has a version');
  assert.ok(Array.isArray(codexMarket.plugins) && codexMarket.plugins.length, 'Codex marketplace lists plugins');
});

ok('versions are aligned across every surface', () => {
  const v = pkg.version;
  assert.strictEqual(claudePlugin.version, v, 'Claude plugin.json version matches package.json');
  assert.strictEqual(claudeMarket.metadata.version, v, 'Claude marketplace metadata version matches package.json');
  assert.strictEqual(claudeMarket.plugins[0].version, v, 'Claude marketplace plugin version matches package.json');
  assert.strictEqual(codexPlugin.version, v, 'Codex plugin.json version matches package.json');
});

ok('Codex manifest has required install metadata', () => {
  assert.strictEqual(codexPlugin.name, 'torque-loop', 'Codex plugin name matches repo identity');
  assert.strictEqual(codexPlugin.skills, './skills/', 'Codex manifest points at skills');
  assert.ok(codexPlugin.author && codexPlugin.author.name, 'Codex manifest has author.name');
  assert.ok(codexPlugin.interface, 'Codex manifest has interface metadata');
  for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
    assert.ok(codexPlugin.interface[field], `Codex interface.${field} exists`);
  }
  assert.ok(Array.isArray(codexPlugin.interface.capabilities), 'Codex interface.capabilities is an array');
  assert.ok(Array.isArray(codexPlugin.interface.defaultPrompt), 'Codex interface.defaultPrompt is an array');
});

ok('Codex marketplace installs this repo as a local plugin source', () => {
  const entry = codexMarket.plugins.find((p) => p.name === codexPlugin.name);
  assert.ok(entry, 'Codex marketplace has a torque-loop entry');
  assert.deepStrictEqual(entry.source, { source: 'local', path: './' });
  assert.deepStrictEqual(entry.policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
  assert.strictEqual(entry.category, 'Developer Tools');
});

ok('CLI VERSION constants match package.json', () => {
  const cli = require('../src/cli');
  const evolve = require('../src/evolve/index');
  assert.strictEqual(cli.VERSION, pkg.version, 'ratchet CLI version matches package.json');
  assert.strictEqual(evolve.VERSION, pkg.version, 'ratchet-evolve CLI version matches package.json');
});

ok('hooks/hooks.json exists and parses', () => {
  const hooks = readJson('hooks/hooks.json');
  assert.ok(hooks.hooks, 'hooks.json has a hooks map');
});

ok('every bin target from package.json exists', () => {
  for (const [name, rel] of Object.entries(pkg.bin || {})) {
    assert.ok(exists(rel), `bin ${name} -> ${rel} exists`);
  }
  assert.ok(exists('bin/ratchet'), 'bin/ratchet exists');
  assert.ok(exists('bin/ratchet-evolve'), 'bin/ratchet-evolve exists');
});

ok('required plugin directories exist', () => {
  for (const d of ['.agents', '.claude-plugin', '.codex-plugin', 'skills', 'agents', 'hooks', 'bin', 'src']) {
    assert.ok(fs.existsSync(path.join(root, d)), `${d}/ exists`);
  }
});

const skillDirs = fs
  .readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

ok('every skill has a SKILL.md with frontmatter + description', () => {
  assert.ok(skillDirs.length > 0, 'at least one skill');
  for (const name of skillDirs) {
    const rel = `skills/${name}/SKILL.md`;
    assert.ok(exists(rel), `${rel} exists`);
    const fm = frontmatter(read(rel));
    assert.ok(fm, `${name}: SKILL.md has YAML frontmatter`);
    assert.ok(/(^|\n)description:/.test(fm), `${name}: SKILL.md frontmatter has a description`);
  }
});

ok('every agent has a .md with frontmatter', () => {
  const agents = fs.readdirSync(path.join(root, 'agents')).filter((f) => f.endsWith('.md'));
  assert.ok(agents.length > 0, 'at least one agent');
  for (const f of agents) {
    const fm = frontmatter(read(`agents/${f}`));
    assert.ok(fm, `agents/${f} has frontmatter`);
    assert.ok(/(^|\n)description:/.test(fm), `agents/${f} frontmatter has a description`);
  }
});

ok('the evolution command was renamed to /ratchet:evolve', () => {
  assert.ok(skillDirs.includes('evolve'), 'skills/evolve exists');
  assert.ok(!skillDirs.includes('ratchet-evolve'), 'skills/ratchet-evolve was removed');
});

ok('README command list matches the skill folders', () => {
  const readme = read('README.md');
  for (const name of skillDirs) {
    assert.ok(readme.includes(`/ratchet:${name}`), `README references /ratchet:${name}`);
  }
});

ok('README does not mention removed command names', () => {
  const readme = read('README.md');
  assert.ok(!readme.includes('/ratchet:ratchet-evolve'), 'no stale /ratchet:ratchet-evolve in README');
});

ok('the /ratchet:map fog gate is wired into the prompt catalog', () => {
  // The generic loops above already force skills/map to carry frontmatter and be
  // listed in the README. PROMPTS.md sync is otherwise untested, so guard it here:
  // the map skill exists AND its canonical intent lives in the prompt source of truth.
  assert.ok(skillDirs.includes('map'), 'skills/map exists');
  const prompts = read('reference/PROMPTS.md');
  assert.ok(prompts.includes('/ratchet:map'), 'PROMPTS.md references /ratchet:map');
});

process.stdout.write(`\n${passed} passed\n`);
