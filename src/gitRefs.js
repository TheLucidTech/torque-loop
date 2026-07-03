'use strict';

const { execFileSync } = require('child_process');

// Base-qualified git status. The session that inspired 0.3 reported "43 ahead of
// main" — true only against a stale local `main`; the useful truth was "82 ahead
// of origin/main, 10 ahead of origin/wip". So this helper NEVER emits an
// ahead/behind number without naming the ref it was measured against.

function safeGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch (_e) {
    return null;
  }
}

function refExists(ref, cwd) {
  return safeGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd) != null;
}

// `git rev-list --left-right --count base...HEAD` → "<behind> <ahead>":
// left  = reachable from base but not HEAD  → HEAD is *behind* by that many
// right = reachable from HEAD but not base  → HEAD is *ahead* by that many
function aheadBehind(base, cwd) {
  if (!refExists(base, cwd)) return null;
  const out = safeGit(['rev-list', '--left-right', '--count', `${base}...HEAD`], cwd);
  if (!out) return null;
  const [behind, ahead] = out.split(/\s+/).map((n) => parseInt(n, 10));
  if (Number.isNaN(behind) || Number.isNaN(ahead)) return null;
  return { base, ahead, behind };
}

function statusRefs(cwd = process.cwd()) {
  if (safeGit(['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') {
    return { isRepo: false };
  }

  const branch = safeGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const head = safeGit(['rev-parse', '--short', 'HEAD'], cwd);
  const upstream = safeGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd); // null if none
  const dirty = (safeGit(['status', '--porcelain'], cwd) || '').length > 0;

  // Compare against every base that actually exists — the tracking ref first,
  // then the usual mains. Each result carries its own base name.
  const bases = [];
  if (upstream) bases.push(upstream);
  for (const b of ['main', 'origin/main', 'master', 'origin/master']) {
    if (!bases.includes(b)) bases.push(b);
  }
  const comparisons = bases.map((b) => aheadBehind(b, cwd)).filter(Boolean);

  // Unpushed = commits on HEAD not on the upstream tracking ref.
  let unpushed = null;
  if (upstream) {
    const c = safeGit(['rev-list', '--count', `${upstream}..HEAD`], cwd);
    unpushed = c == null ? null : parseInt(c, 10);
  }

  // Does any remote-tracking branch already contain HEAD? (Is this pushed?)
  const remoteContains = safeGit(['branch', '-r', '--contains', 'HEAD'], cwd);
  const remoteContainsHead = Boolean(remoteContains && remoteContains.trim());

  return {
    isRepo: true,
    branch,
    head,
    upstream: upstream || null,
    dirty,
    comparisons,
    unpushed,
    remoteContainsHead,
  };
}

module.exports = { statusRefs, aheadBehind, safeGit };
