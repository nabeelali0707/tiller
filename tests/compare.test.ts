import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/storage/store.js';
import { taskSchema } from '../src/core/contracts.js';
import { ScriptedAdapter } from '../src/adapters/scripted.js';
import { compare, strategies } from '../src/eval/compare.js';
import type { Strategy } from '../src/eval/compare.js';
import { instructions } from '../src/adapters/prompt.js';

test('all four comparison conditions share snapshots and limits and retain independent traces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-compare-'));
  const store = new Store(dir);
  try {
    const task = taskSchema.parse({ ...JSON.parse(readFileSync('examples/repair/task.json', 'utf8')), repository: resolve('examples/repair/repo') });
    const mapping = JSON.parse(readFileSync('examples/comparison/scripts.json', 'utf8')) as Record<Strategy, string>;
    const result = await compare(store, task, strategies, 1, (strategy) => ScriptedAdapter.fromFile(resolve('examples/comparison', mapping[strategy])));
    assert.equal(result.report.status, 'completed'); assert.equal(result.report.rows.length, 4);
    assert.ok(result.report.rows.every((row) => row.accepted));
    assert.equal(new Set(result.report.rows.map((row) => row.runId)).size, 4);
    for (const row of result.report.rows) {
      const run = store.load(row.runId);
      assert.deepEqual(run.task.budget, task.budget);
      const events = store.events(row.runId);
      if (row.strategy === 'flat-react') {
        assert.equal(run.planVersion, 0); assert.equal(run.declaredPlan, undefined);
        assert.equal(events.some((e) => e.type.startsWith('plan.')), false);
      }
      if (row.strategy === 'plan-react') {
        assert.equal(run.planVersion, 1); assert.ok(run.declaredPlan);
        assert.equal(events.some((e) => e.type === 'plan.revised'), false);
      }
      if (row.strategy === 'hierarchical') assert.ok(run.hierarchy);
    }
    assert.match(readFileSync(result.path, 'utf8'), /not a benchmark/);
    const reactiveRun = store.load(result.report.rows[0]!.runId);
    assert.match(instructions(reactiveRun), /Do not generate remainingPlan/);
    await assert.rejects(compare(store, task, strategies, 0, () => { throw new Error('should not call'); }), /Repeats/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('already cancelled comparison dispatches nothing and saves interruption report', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-compare-cancel-'));
  const store = new Store(dir);
  try {
    const task = taskSchema.parse(JSON.parse(readFileSync('examples/repair/task.json', 'utf8')));
    const controller = new AbortController(); controller.abort();
    const result = await compare(store, task, ['sequential'], 1,
      () => ScriptedAdapter.fromFile('examples/repair/script.json'), controller.signal);
    assert.equal(result.report.status, 'interrupted'); assert.equal(result.report.rows.length, 0);
    assert.match(readFileSync(result.path, 'utf8'), /interrupted/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
