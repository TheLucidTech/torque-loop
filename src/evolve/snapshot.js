'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { nowIso } = require('./schema');

// Baseline capture. No baseline = no evolution, just rewriting.

const EXT_MODE = {
  '.js': 'code',
  '.mjs': 'code',
  '.cjs': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.jsx': 'code',
  '.py': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.java': 'code',
  '.rb': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.sh': 'code',
  '.md': 'docs',
  '.mdx': 'docs',
  '.txt': 'docs',
  '.json': 'workflow',
  '.yaml': 'workflow',
  '.yml': 'workflow',
};

function detectMode(target) {
  const base = path.basename(String(target)).toLowerCase();
  if (base === 'skill.md' || base.endsWith('.prompt') || base.endsWith('.prompt.md')) return 'prompt';
  const ext = path.extname(base);
  return EXT_MODE[ext] || 'code';
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function safeGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch (_e) {
    return null;
  }
}

function gitState(file, cwd) {
  const inRepo = safeGit(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
  if (!inRepo) return null;
  const rel = path.isAbsolute(file) ? path.relative(cwd, file) : file;
  const status = safeGit(['status', '--porcelain', '--', rel], cwd);
  return {
    branch: safeGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    tracked: safeGit(['ls-files', '--error-unmatch', rel], cwd) != null,
    dirty: (status || '').length > 0,
    status: (status || '').trim() || 'clean',
  };
}

function snapshot({ target, goal = '', mode = 'auto', cwd = process.cwd() }) {
  if (!target) throw new Error('snapshot requires a <target>');
  const resolved = path.isAbsolute(target) ? target : path.join(cwd, target);
  const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();

  let content = '';
  let bytes = 0;
  if (exists) {
    content = fs.readFileSync(resolved, 'utf8');
    bytes = Buffer.byteLength(content, 'utf8');
  }

  const resolvedMode = mode === 'auto' ? detectMode(target) : mode;
  // When the target is not a file, the baseline hashes the goal so a change of
  // intent still registers as a distinct baseline.
  const baselineHash = sha256(exists ? content : `goal:${goal}`);

  return {
    target,
    exists,
    mode: resolvedMode,
    goal,
    baselineHash,
    bytes,
    lines: exists ? content.split('\n').length : 0,
    git: exists ? gitState(resolved, cwd) : null,
    timestamp: nowIso(),
  };
}

module.exports = { snapshot, detectMode, sha256 };
