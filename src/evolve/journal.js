'use strict';

const fs = require('fs');
const path = require('path');

const { newEvent } = require('./schema');

// The evolution log lives in the project, not the shared plugin data dir:
// evolution events are tied to specific artifacts in this repo, so the trail
// belongs next to them. Override with RATCHET_EVOLVE_LOG.

function logPath(cwd = process.cwd()) {
  if (process.env.RATCHET_EVOLVE_LOG && process.env.RATCHET_EVOLVE_LOG.trim()) {
    return process.env.RATCHET_EVOLVE_LOG.trim();
  }
  return path.join(cwd, '.ratchet', 'evolve-log.jsonl');
}

function readEvents(cwd = process.cwd()) {
  const file = logPath(cwd);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (_e) {
        return null;
      }
    })
    .filter(Boolean);
}

function dateStamp(iso) {
  // evo_2026_07_03_001 — derive the date part from the event timestamp.
  return String(iso).slice(0, 10).replace(/-/g, '_');
}

function nextId(cwd, iso) {
  const day = dateStamp(iso);
  const sameDay = readEvents(cwd).filter((e) => String(e.id).includes(`evo_${day}_`));
  const seq = String(sameDay.length + 1).padStart(3, '0');
  return `evo_${day}_${seq}`;
}

function appendEvent(cwd, fields) {
  const event = newEvent(fields);
  if (!event.id) event.id = nextId(cwd, event.timestamp);
  const file = logPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
  return event;
}

function status(cwd = process.cwd()) {
  const events = readEvents(cwd);
  if (!events.length) return { events: 0, targets: [], last: null };
  const targets = [...new Set(events.map((e) => e.target))];
  const last = events[events.length - 1];
  const kept = events.filter((e) => e.verdict === 'KEEP').length;
  const reverted = events.filter((e) => e.verdict === 'REVERT').length;
  return { events: events.length, kept, reverted, targets, last };
}

module.exports = { logPath, readEvents, appendEvent, nextId, status };
