'use strict';

const scoring = require('./scoring');
const ledgerMod = require('./ledger');

// All human/agent-facing rendering lives here so the CLI stays a thin router.
// Output is Markdown because it is injected straight into skill prompts.

function dash(v, fallback) {
  return v == null || v === '' ? fallback || '—' : v;
}

function bullets(items, fmt) {
  if (!items || !items.length) return '_none_';
  return items.map((x) => `- ${fmt(x)}`).join('\n');
}

function stateSummary(state) {
  const conf = scoring.scoreConfidence(state);
  const openDefects = (state.defects || []).filter((d) => d.status !== 'resolved' && d.status !== 'closed');
  const openLoops = (state.openLoops || []).filter((l) => l.status !== 'closed');
  const untested = (state.assumptions || []).filter((a) => a.status !== 'tested' && a.status !== 'killed');
  const lastArtifact = (state.artifacts || [])[state.artifacts.length - 1];
  const lastDecision = (state.decisions || [])[state.decisions.length - 1];

  const stale = state.dirty && (!state.lastCompileAt || state.lastCompileAt < state.updatedAt);

  const lines = [];
  lines.push(`### Ratchet state`);
  lines.push(`- **Title:** ${dash(state.title)}`);
  lines.push(`- **Objective:** ${dash(state.objective)}`);
  lines.push(`- **Bottleneck:** ${dash(state.bottleneck)}`);
  lines.push(`- **Phase:** ${dash(state.phase, 'idle')}`);
  lines.push(`- **Confidence:** ${conf.score}/100 (${conf.band})${conf.loopClear ? ' — loop-clear' : ''}`);
  lines.push(
    `- **Open defects:** ${openDefects.length}` +
      (openDefects.length ? ` — ${openDefects.map((d) => `[${d.severity}] ${d.summary}`).slice(0, 5).join('; ')}` : '')
  );
  lines.push(`- **Untested assumptions:** ${untested.length}`);
  lines.push(`- **Open loops:** ${openLoops.length}`);
  lines.push(`- **Last artifact:** ${lastArtifact ? `${lastArtifact.title} (${lastArtifact.status})` : '—'}`);
  lines.push(`- **Last decision:** ${lastDecision ? lastDecision.choice : '—'}`);
  lines.push(`- **Next action:** ${dash(state.nextAction)}`);
  lines.push(`- **Next command:** ${dash(state.nextCommand)}`);
  if (stale) lines.push(`- ⚠️ **Stale:** work changed since last compile — run \`/ratchet:compile\`.`);
  return lines.join('\n');
}

function friction(result) {
  const rows = result.obstacles
    .map(
      (o) =>
        `| ${o.rank} | ${o.name} | ${o.leverage} | ${o.certainty} | ${o.speed} | ${o.risk} | **${o.priority}** |`
    )
    .join('\n');
  const out = [];
  out.push(`### Friction auction`);
  out.push(`Priority = Leverage × Certainty × Time-to-unblock × Risk (each 1–10).`);
  out.push('');
  out.push(`| # | Obstacle | Lev | Cer | Spd | Risk | Priority |`);
  out.push(`| - | -------- | --- | --- | --- | ---- | -------- |`);
  out.push(rows);
  out.push('');
  if (result.winner) {
    out.push(`**Winning bottleneck:** ${result.winner.name} (priority ${result.winner.priority}).`);
    if (result.runnerUp) {
      out.push(`Beats runner-up "${result.runnerUp.name}" (${result.runnerUp.priority}) by ${result.margin}.`);
    }
  }
  return out.join('\n');
}

function confidence(state) {
  const c = scoring.scoreConfidence(state);
  const out = [];
  out.push(`### Confidence: ${c.score}/100 — ${c.band}${c.loopClear ? ' (loop-clear)' : ''}`);
  if (c.penalties.length) {
    out.push('');
    out.push('Draining pressure:');
    out.push(bullets(c.penalties, (p) => `${p.reason} (−${p.cost})`));
  } else {
    out.push('No unresolved pressure detected.');
  }
  out.push('');
  out.push(
    c.loopClear
      ? '**Loop may stop:** no critical/high debt, no untested assumption, next action defined.'
      : '**Loop must continue:** unresolved critical/high debt, untested assumptions, or missing next action.'
  );
  return out.join('\n');
}

function repoSnapshot(snap) {
  const out = [];
  out.push(`### Repo snapshot — ${snap.root}`);
  out.push(`- **Files:** ${snap.fileCount}${snap.truncated ? '+ (truncated)' : ''}`);
  out.push(`- **Top-level dirs:** ${snap.dirs.length ? snap.dirs.join(', ') : '—'}`);
  out.push(`- **Signal files:** ${snap.signals.length ? snap.signals.join(', ') : '—'}`);
  out.push(
    `- **File types:** ${snap.topExts.length ? snap.topExts.map(([e, n]) => `${e}×${n}`).join(', ') : '—'}`
  );
  if (snap.git) {
    out.push(`- **Git:** ${dash(snap.git.branch)} — ${snap.git.dirty ? 'dirty' : 'clean'} — last: ${dash(snap.git.lastCommit)}`);
    if (snap.git.changedFiles && snap.git.changedFiles.length) {
      out.push(`- **Changed:** ${snap.git.changedFiles.join(', ')}`);
    }
  } else {
    out.push(`- **Git:** not a repository`);
  }
  return out.join('\n');
}

function fullExport(state, ledger) {
  const c = scoring.scoreConfidence(state);
  const out = [];
  out.push(`# Ratchet compile — ${dash(state.title, 'untitled session')}`);
  out.push('');
  out.push(`_Updated ${dash(state.updatedAt)} · confidence ${c.score}/100 (${c.band})_`);
  out.push('');
  out.push(`## Objective`);
  out.push(dash(state.objective, '_not locked — run /ratchet:lock_'));
  out.push('');
  out.push(`## Chosen bottleneck`);
  out.push(dash(state.bottleneck));
  out.push('');
  out.push(`## Decisions`);
  out.push(
    bullets(state.decisions, (d) => `**${d.choice}** — rejected: ${dash(d.rejected)} · tripwire: ${dash(d.tripwire)}`)
  );
  out.push('');
  out.push(`## Artifacts`);
  out.push(
    bullets(state.artifacts, (a) => `**${a.title}** (${a.kind}, ${a.status})${a.path ? ` → \`${a.path}\`` : ''}${a.holes && a.holes.length ? ` · holes: ${a.holes.join('; ')}` : ''}`)
  );
  out.push('');
  out.push(`## Defects / risks`);
  out.push(bullets(state.defects, (d) => `[${d.severity}] ${d.summary} — ${d.status}`));
  out.push('');
  out.push(`## Assumptions`);
  out.push(bullets(state.assumptions, (a) => `${a.text} — ${a.status}${a.killTest ? ` · kill-test: ${a.killTest}` : ''}`));
  out.push('');
  out.push(`## Open loops`);
  out.push(bullets(state.openLoops, (l) => `${l.text} — ${l.status}`));
  out.push('');
  out.push(`## Next`);
  out.push(`- **Action:** ${dash(state.nextAction)}`);
  out.push(`- **Command:** ${dash(state.nextCommand)}`);
  out.push(`- **Tags:** ${state.tags && state.tags.length ? state.tags.join(', ') : '—'}`);
  if (ledger) {
    const ls = ledgerMod.summary(ledger);
    out.push('');
    out.push(`## QA ledger`);
    out.push(`- Features: ${ls.features} · Tests: ${ls.tests} (${ls.failingTests} failing) · Defects: ${ls.defects} (${ls.openDefects} open)`);
  }
  return out.join('\n');
}

module.exports = { stateSummary, friction, confidence, repoSnapshot, fullExport, dash, bullets };
