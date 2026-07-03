'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// A cheap, dependency-free read of the repo the session is working in.
// Injected into skills so Claude sees ground truth, not its own memory.

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
]);

// Dot-directories that ARE meaningful to a plugin/repo and must not be hidden.
// Without this, a blanket dot-dir skip loses plugin manifests and CI metadata.
const DOT_DIR_ALLOWLIST = new Set(['.agents', '.claude', '.claude-plugin', '.codex-plugin', '.github', '.ratchet']);

function shouldSkipDir(name) {
  if (IGNORE_DIRS.has(name)) return true;
  if (name.startsWith('.') && !DOT_DIR_ALLOWLIST.has(name)) return true;
  return false;
}

const SIGNAL_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'Dockerfile',
  'docker-compose.yml',
  'Makefile',
  'README.md',
  '.env.example',
];

function safeExec(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch (_e) {
    return null;
  }
}

function walk(root, maxFiles = 4000) {
  const extCounts = {};
  let fileCount = 0;
  let truncated = false;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        // Skip ignored dirs and non-allowlisted dot-dirs (e.g. .git, .cache).
        if (shouldSkipDir(e.name)) continue;
        stack.push(path.join(dir, e.name));
      } else if (e.isFile()) {
        fileCount++;
        if (fileCount > maxFiles) {
          truncated = true;
          continue;
        }
        const ext = path.extname(e.name).toLowerCase() || '(none)';
        extCounts[ext] = (extCounts[ext] || 0) + 1;
      }
    }
  }
  return { extCounts, fileCount, truncated };
}

function topDirs(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !shouldSkipDir(e.name))
      .map((e) => e.name)
      .sort();
  } catch (_e) {
    return [];
  }
}

function snapshot(cwd) {
  const root = cwd || process.cwd();
  const { extCounts, fileCount, truncated } = walk(root);
  const dirs = topDirs(root);
  const signals = SIGNAL_FILES.filter((f) => fs.existsSync(path.join(root, f)));

  const isGit = fs.existsSync(path.join(root, '.git')) || safeExec('git', ['rev-parse', '--is-inside-work-tree'], root) === 'true';
  let git = null;
  if (isGit) {
    git = {
      branch: safeExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root),
      dirty: (safeExec('git', ['status', '--porcelain'], root) || '').length > 0,
      lastCommit: safeExec('git', ['log', '-1', '--pretty=%h %s'], root),
      changedFiles: (safeExec('git', ['status', '--porcelain'], root) || '')
        .split('\n')
        .filter(Boolean)
        .slice(0, 20),
    };
  }

  const topExts = Object.entries(extCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  return { root, fileCount, truncated, dirs, signals, git, topExts };
}

module.exports = { snapshot };
