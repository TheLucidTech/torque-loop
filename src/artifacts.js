'use strict';

const state = require('./state');
const schemas = require('./schemas');

// Thin helpers for the two collections skills touch most: artifacts + defects.
// Every write flips state.dirty so the Stop hook can nag if nothing was
// compiled afterward.

function addArtifact(cwd, item) {
  const s = state.loadState(cwd);
  const record = {
    id: item.id || state.makeId('art'),
    at: schemas.nowIso(),
    kind: item.kind || 'artifact',
    title: item.title || 'untitled',
    path: item.path || '',
    status: item.status || 'v0',
    holes: Array.isArray(item.holes) ? item.holes : item.holes ? [item.holes] : [],
  };
  // A probe's drain is an invariant, not a convention: build-for-learn code
  // must cost confidence until disposed or promoted, even when the caller
  // omits the hole.
  if (record.kind === 'probe' && !record.holes.some((h) => /disposal:\s*pending/i.test(String(h)))) {
    record.holes.push('disposal: pending');
  }
  s.artifacts.push(record);
  s.dirty = true;
  s.history.push({ id: state.makeId('hist'), at: record.at, event: 'artifact.add', note: record.title });
  // The map landing is the fog entering durable state: close the fog loop that
  // `score aperture` opened, so the drain tracks reality instead of nagging past
  // the point the map answered it. (The map's own OPEN items keep draining as
  // this artifact's holes.)
  if (record.kind === 'unknown-map') {
    for (const l of s.openLoops || []) {
      if (l.status !== 'closed' && String(l.text || '').startsWith(schemas.FOG_LOOP_PREFIX)) {
        l.status = 'closed';
        l.closedBy = record.id;
      }
    }
  }
  state.saveState(cwd, s);
  return record;
}

function addDefect(cwd, item, { alsoLedger = true } = {}) {
  const s = state.loadState(cwd);
  const now = schemas.nowIso();
  const sev = (item.severity || 'medium').toLowerCase();
  const record = {
    id: item.id || state.makeId('def'),
    at: now,
    severity: schemas.SEVERITIES.includes(sev) ? sev : 'medium',
    summary: item.summary || item.title || 'unspecified defect',
    status: item.status || 'open',
    artifact: item.artifact || '',
  };
  s.defects.push(record);
  s.dirty = true;
  s.history.push({ id: state.makeId('hist'), at: now, event: 'defect.add', note: `[${record.severity}] ${record.summary}` });
  state.saveState(cwd, s);

  let ledgerRecord = null;
  if (alsoLedger) {
    const ledger = require('./ledger');
    ledgerRecord = ledger.upsert(cwd, 'defects', {
      feature: item.feature || '',
      severity: record.severity,
      summary: record.summary,
      status: record.status,
      foundAt: now,
    }).item;
    // Link the state defect to its ledger mirror so lifecycle transitions can
    // keep both surfaces honest instead of letting the ledger silently drift.
    record.ledgerId = ledgerRecord.id;
    state.saveState(cwd, s);
  }
  return { state: record, ledger: ledgerRecord };
}

// Move a defect through its lifecycle: open/patched/reopened → resolved | waived
// | superseded, or resolved → reopened. This is the mutation the CLI lacked in
// 0.2: a defect could be born but never cleared, so remediated work stayed
// confidence-blocking forever. The scorer already honors terminal statuses
// (scoring.isDefectOpen); this is what finally lets a defect *reach* one.
function transitionDefect(cwd, id, toStatus, meta = {}) {
  if (!schemas.DEFECT_STATUSES.includes(toStatus)) {
    throw new Error(`unknown defect status "${toStatus}". valid: ${schemas.DEFECT_STATUSES.join(', ')}`);
  }
  const s = state.loadState(cwd);
  const d = (s.defects || []).find((x) => x.id === id);
  if (!d) throw new Error(`no defect with id "${id}"`);
  const now = schemas.nowIso();
  const from = d.status || 'open';

  d.status = toStatus;
  d.log = Array.isArray(d.log) ? d.log : [];
  d.log.push({ at: now, from, to: toStatus, note: meta.note || '' });

  // Stamp the fields each transition owns; clear stale ones on reopen.
  if (toStatus === 'resolved') {
    d.resolvedAt = now;
    if (meta.evidence) d.evidence = meta.evidence;
  }
  if (toStatus === 'reopened') {
    d.resolvedAt = null;
    d.reopenReason = meta.reason || '';
  }
  if (toStatus === 'waived') {
    d.waivedBy = meta.owner || '';
    d.waiveReason = meta.reason || '';
  }
  if (toStatus === 'superseded') {
    d.supersededBy = meta.by || '';
  }

  s.dirty = true;
  s.history.push({ id: state.makeId('hist'), at: now, event: `defect.${toStatus}`, note: `${id}: ${from} → ${toStatus}` });
  state.saveState(cwd, s);

  // Keep the QA ledger mirror in step. Best-effort: a defect added before the
  // link existed has no mirror to sync, and a ledger hiccup must never strand a
  // state transition that already succeeded.
  if (d.ledgerId) {
    try {
      require('./ledger').upsert(cwd, 'defects', { id: d.ledgerId, status: toStatus });
    } catch (_e) {
      /* ledger sync is best-effort */
    }
  }
  return d;
}

// Retract an artifact whose claim turned out false or obsolete. Provenance is
// preserved (keptForProvenance) — the record stays in history, but its status
// flips to `retracted` so it stops steering cold sessions and its holes stop
// draining confidence. This is the move the T2.3 re-scope doc needed when its
// central premise ("no endpoint exists") was disproven by the live seam.
function retractArtifact(cwd, id, { reason = '', supersededBy = '' } = {}) {
  const s = state.loadState(cwd);
  const a = (s.artifacts || []).find((x) => x.id === id);
  if (!a) throw new Error(`no artifact with id "${id}"`);
  // A probe retraction is its lifecycle exit and must state which one: the
  // code died (disposed) or was explicitly rebuilt for keep (promoted). A
  // vague reason would let residue stop draining without either outcome.
  if (a.kind === 'probe') {
    if (!/^(disposed|promoted):/i.test(reason)) {
      throw new Error(
        'a probe retraction must state its outcome: --reason must start with "disposed:" (code reverted, finding recorded) or "promoted:" (rebuilt for keep)'
      );
    }
    if (/^promoted:/i.test(reason) && !supersededBy) {
      throw new Error('a promoted probe requires --superseded-by <artifact-id> — the build-for-keep that replaced it');
    }
  }
  const now = schemas.nowIso();
  a.status = 'retracted';
  a.retracted = { at: now, reason, supersededBy, keptForProvenance: true };
  s.dirty = true;
  s.history.push({
    id: state.makeId('hist'),
    at: now,
    event: 'artifact.retracted',
    note: `${id}: ${reason}${supersededBy ? ` → superseded by ${supersededBy}` : ''}`,
  });
  state.saveState(cwd, s);
  return a;
}

module.exports = { addArtifact, addDefect, transitionDefect, retractArtifact };
