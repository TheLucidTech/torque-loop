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
  s.artifacts.push(record);
  s.dirty = true;
  s.history.push({ id: state.makeId('hist'), at: record.at, event: 'artifact.add', note: record.title });
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
  }
  return { state: record, ledger: ledgerRecord };
}

module.exports = { addArtifact, addDefect };
