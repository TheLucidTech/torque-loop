'use strict';

const { spawnSync } = require('child_process');

// Verification gathers EVIDENCE. It runs the test command and reports the raw
// result. It never decides KEEP/REVERT — that verdict is the model's, made from
// this evidence. No test command means no automated pass: the result is
// 'manual', and the SKILL must supply explicit manual checks instead.

function tail(s, n = 40) {
  if (!s) return '';
  const lines = String(s).trimEnd().split('\n');
  return lines.slice(-n).join('\n');
}

function runCommand(cmd, cwd = process.cwd(), timeout = 120000) {
  const res = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
  return {
    command: cmd,
    exitCode: res.status,
    pass: res.status === 0 && !timedOut && !res.error,
    timedOut,
    stdoutTail: tail(res.stdout),
    stderrTail: tail(res.stderr),
  };
}

const MANUAL_CHECKS = {
  code: [
    'the change compiles / imports cleanly',
    'the targeted behavior actually changed',
    'no unrelated code was touched',
  ],
  prompt: [
    'a lazy model cannot escape the instruction',
    'the prompt still forces a concrete output',
    'it prevents self-praise and leaves durable state',
  ],
  docs: [
    'first-use path is unambiguous',
    'no contradiction with the rest of the doc',
    'no missing step between install and first success',
  ],
  workflow: ['a dry-run against a realistic scenario succeeds', 'no step silently no-ops'],
};

function verify({ target, testCommand, mode = 'code', cwd = process.cwd() }) {
  if (testCommand) {
    const r = runCommand(testCommand, cwd);
    return {
      target,
      mode,
      commands: [r],
      manualChecks: [],
      result: r.pass ? 'pass' : 'fail',
    };
  }
  return {
    target,
    mode,
    commands: [],
    manualChecks: MANUAL_CHECKS[mode] || MANUAL_CHECKS.code,
    result: 'manual',
  };
}

module.exports = { verify, runCommand, MANUAL_CHECKS };
