import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('CLI runs a task, inspects/replays without executing, and emits an applicable patch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-cli-'));
  const cli = resolve('dist/src/cli.js');
  const invoke = (args: string[]) => execFileSync(process.execPath, [cli, ...args, '--data-dir', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const report = JSON.parse(invoke(['run', 'examples/repair/task.json', '--script', 'examples/repair/script.json'])) as { id: string; status: string; spent: unknown };
    assert.equal(report.status, 'succeeded');
    const before = invoke(['trace', report.id]);
    const inspect = JSON.parse(invoke(['inspect', report.id])) as { spent: unknown };
    assert.deepEqual(inspect.spent, report.spent);
    const patch = invoke(['diff', report.id]);
    assert.match(patch, /--- a\/add.cjs/); assert.match(patch, /\+exports.add = \(a, b\) => a \+ b/);
    assert.equal(invoke(['trace', report.id]), before);
    const result = spawnSync('git', ['apply', '--check', '-'], { cwd: resolve('examples/repair/repo'), input: patch, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync('examples/repair/repo/add.cjs', 'utf8'), /a - b/);
    const invalid = spawnSync(process.execPath, [cli, 'run', 'examples/repair/task.json', '--scrpt', 'bad'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /Unknown option/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
