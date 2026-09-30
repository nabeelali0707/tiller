import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskSchema } from '../src/core/contracts.js';
import { snapshot, safeFile, writeAllowed } from '../src/tools/workspace.js';
import { runCheck } from '../src/tools/checks.js';

test('snapshot preserves originals and rejects undeclared writes and symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-files-'));
  try {
    const repo = join(dir, 'repo'); mkdirSync(repo);
    writeFileSync(join(repo, 'a.js'), 'original'); writeFileSync(join(repo, 'test.js'), 'protected');
    const task = taskSchema.parse({ version: 1, goal: 'test', repository: repo, files: ['a.js', 'test.js'], editable: ['a.js'], checks: [{ id: 'test', command: 'node', args: ['test.js'] }] });
    const runDir = join(dir, 'run'); snapshot(task, runDir);
    const run = { task } as Parameters<typeof writeAllowed>[0];
    assert.throws(() => writeAllowed(run, join(runDir, 'workspace'), 'test.js', 'weakened'), /denied/);
    writeAllowed(run, join(runDir, 'workspace'), 'a.js', 'edited');
    assert.equal(readFileSync(join(repo, 'a.js'), 'utf8'), 'original');
    assert.equal(readFileSync(join(runDir, 'original', 'a.js'), 'utf8'), 'original');
    symlinkSync(repo, join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => safeFile(dir, 'link/a.js'), /Symlinks/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checks report exit failure, cap output and kill on timeout', async () => {
  const controller = new AbortController();
  const base = { id: 'test', command: 'node', timeoutMs: 5000 };
  const fail = await runCheck({ ...base, args: ['-e', 'process.exit(7)'] }, process.cwd(), controller.signal, 5000);
  assert.equal(fail.passed, false); assert.equal(fail.exitCode, 7);
  const output = await runCheck({ ...base, args: ['-e', "process.stdout.write('x'.repeat(100000))"] }, process.cwd(), controller.signal, 5000);
  assert.equal(output.passed, true); assert.equal(output.truncated, true); assert.equal(output.output.length, 16_384);
  const timeout = await runCheck({ ...base, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 150 }, process.cwd(), controller.signal, 5000);
  assert.equal(timeout.passed, false); assert.equal(timeout.timedOut, true);
});

test('checks do not inherit provider secrets or Node injection flags', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-sentinel-not-a-real-key';
  try {
    const result = await runCheck({ id: 'env', command: 'node', args: ['-e', 'process.exit(process.env.OPENAI_API_KEY ? 1 : 0)'], timeoutMs: 5000 }, process.cwd(), new AbortController().signal, 5000);
    assert.equal(result.passed, true);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});
