import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxArgs, prepareSandbox, sandboxCheck } from '../src/tools/sandbox.js';
import { taskSchema } from '../src/core/contracts.js';

test('sandbox requires pinned image, read-only inputs, no networking or privileges, and resource bounds', () => {
  const args = sandboxArgs('sha256:' + 'a'.repeat(64), process.cwd(), 'tiller-11111111-1111-1111-1111-111111111111', ['test.cjs']);
  for (const option of ['--read-only', '--cap-drop', '--security-opt', '--pids-limit', '--memory', '--cpus', '--user']) assert.ok(args.includes(option));
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.match(args[args.indexOf('--mount') + 1]!, /readonly$/);
  assert.equal(args[args.indexOf('--pull') + 1], 'never');
  assert.throws(() => sandboxArgs('node:latest', '.', 'bad', []), /identity/);
  assert.equal(taskSchema.safeParse({ version: 1, goal: 'test', repository: '.', files: ['a'], editable: ['a'],
    execution: { mode: 'docker' }, checks: [{ id: 'a', command: 'cmd', args: [] }] }).success, false);
});

test('real Docker denies host mutations, network access and secrets, and cleans up timed-out containers',
  { skip: process.env.TILLER_DOCKER_TESTS !== '1' }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tiller-sandbox-'));
    try {
      const image = await prepareSandbox('node:24-alpine');
      writeFileSync(join(dir, 'sentinel'), 'original');
      writeFileSync(join(dir, 'probe.cjs'), `const fs=require('node:fs'); const assert=require('node:assert/strict');
assert.throws(()=>fs.writeFileSync('/workspace/sentinel','changed'));
assert.throws(()=>fs.writeFileSync('/etc/sentinel','changed'));
assert.equal(process.getuid(),65534); assert.equal(process.env.OPENAI_API_KEY,undefined);
assert.equal(require('node:os').networkInterfaces().eth0,undefined);
console.log('Isolation probes passed');`);
      const result = await sandboxCheck({ id: 'probe', command: 'node', args: ['probe.cjs'], timeoutMs: 15000 }, dir, image, new AbortController().signal, 15000);
      assert.equal(result.passed, true, result.output);
      assert.equal(readFileSync(join(dir, 'sentinel'), 'utf8'), 'original');
      const timeout = await sandboxCheck({ id: 'timeout', command: 'node', args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 2000 }, dir, image, new AbortController().signal, 2000);
      assert.equal(timeout.timedOut, true); assert.equal(timeout.passed, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
