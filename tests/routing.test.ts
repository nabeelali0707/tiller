import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/store.js';
import { taskSchema } from '../src/core/contracts.js';
import type { Adapter } from '../src/core/contracts.js';
import { createRun, execute } from '../src/executors/runtime.js';
import { runCheck } from '../src/tools/checks.js';
import { applySwitch, switchTarget } from '../src/core/routing.js';

test('dynamic hierarchy to sequential to Search keeps workspace, budgets, history and deadline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-routing-')); const store = new Store(dir);
  try {
    const task = taskSchema.parse({ ...JSON.parse(readFileSync('examples/repair/task.json', 'utf8')),
      repository: resolve('examples/repair/repo'), strategy: 'hierarchical', execution: { mode: 'docker' },
      routing: { enabled: true }, budget: { maxModelCalls: 24, maxToolCalls: 40, maxDurationMs: 60000, maxOutputTokensPerCall: 2048 } });
    const script = JSON.parse(readFileSync('examples/hierarchical/script.json', 'utf8'));
    const adapter: Adapter = { id: 'dynamic-fixture', next: async (run) => {
      if (run.task.strategy === 'hierarchical') {
        if (run.decisionIndex < 3) return { decision: script[run.decisionIndex] };
        return { decision: { nodeId: 'repair', reason: 'Request evidence', remainingPlan: ['Verify'], action: { type: 'complete', summary: 'Proposed repair' } } };
      }
      if (run.task.goal.includes('Search candidate') && run.decisionIndex === 0)
        return { decision: { reason: 'Apply repair', remainingPlan: ['Repair', 'Verify'], action: { type: 'write', path: 'add.cjs', content: 'exports.add=(a,b)=>a+b;\n' } } };
      return { decision: { reason: 'Request evidence', remainingPlan: ['Verify'], action: { type: 'complete', summary: 'Proposed repair' } } };
    } };
    const run = createRun(store, task, adapter);
    const result = await execute(store, run.id, adapter, undefined, undefined, {
      prepare: async () => 'sha256:' + 'a'.repeat(64),
      check: async (check, workspace, _image, signal, timeout) => runCheck(check, workspace, signal, timeout),
    });
    assert.equal(result.status, 'succeeded', result.message);
    assert.deepEqual(result.segments!.map((segment) => segment.strategy), ['hierarchical', 'sequential', 'search']);
    assert.ok(result.segments![0]!.hierarchy); assert.equal(result.hierarchy, undefined);
    assert.ok(result.segments![2]!.calls > result.segments![1]!.calls);
    assert.equal(store.events(run.id).filter((event) => event.type === 'strategy.switched').length, 2);
    assert.ok(result.calls <= task.budget.maxModelCalls); assert.ok(result.tools <= task.budget.maxToolCalls);
    for (const child of result.searchState!.candidates) assert.equal(store.load(child).deadline, result.deadline);
    assert.equal(switchTarget(result), null);
    assert.throws(() => applySwitch(result, 'hierarchical'), /unsupported/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
