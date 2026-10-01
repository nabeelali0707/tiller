import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRun, execute } from '../src/executors/runtime.js';
import { taskSchema } from '../src/core/contracts.js';
import type { Adapter } from '../src/core/contracts.js';
import { Store } from '../src/storage/store.js';
import { runCheck } from '../src/tools/checks.js';
import type { SandboxServices } from '../src/tools/sandbox.js';

// Real local checks validate scheduling/accounting here. These tests do not establish Docker isolation.
const localChecks: SandboxServices = { prepare: async () => 'sha256:' + 'a'.repeat(64),
  check: async (check, workspace, _image, signal, timeout) => runCheck(check, workspace, signal, timeout) };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-search-')); const store = new Store(dir);
  const task = taskSchema.parse({ ...JSON.parse(readFileSync('examples/repair/task.json', 'utf8')),
    repository: resolve('examples/repair/repo'), strategy: 'search', execution: { mode: 'docker' },
    budget: { maxModelCalls: 8, maxToolCalls: 14, maxDurationMs: 60000, maxOutputTokensPerCall: 2048 } });
  return { store, task, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const completion = { remainingPlan: ['Verify'], reason: 'Request real verification', action: { type: 'complete', summary: 'Finished' } };

test('Search charges losing candidates, starts identical snapshots and verifies promoted winner', async () => {
  const f = fixture();
  try {
    const adapter: Adapter = { id: 'search-fixture', next: async (run) => ({ decision:
      run.task.goal.includes('candidate 2/') && run.decisionIndex === 0 ?
        { remainingPlan: ['Repair', 'Verify'], reason: 'Fix arithmetic', action: { type: 'write', path: 'add.cjs', content: 'exports.add=(a,b)=>a+b;\n' } } : completion,
      usage: { inputTokens: 10, outputTokens: 20 } }) };
    const parent = createRun(f.store, f.task, adapter);
    const result = await execute(f.store, parent.id, adapter, undefined, undefined, localChecks);
    assert.equal(result.status, 'succeeded', result.message);
    const children = result.searchState!.candidates.map((id) => f.store.load(id));
    assert.equal(children.length, 2); assert.equal(children[0]!.status, 'budget_exhausted'); assert.equal(children[1]!.status, 'succeeded');
    for (const child of children) {
      assert.deepEqual((f.store.events(child.id)[0]!.data as { snapshot: unknown }).snapshot, result.searchState!.entryHashes);
      assert.equal(child.deadline, result.deadline);
    }
    assert.equal(result.calls, children.reduce((sum, child) => sum + child.calls, 0));
    assert.equal(result.tools, children.reduce((sum, child) => sum + child.tools, 0) + 2);
    assert.equal(result.inputTokens, result.calls * 10);
    assert.equal(result.unknownUsageCalls, 0);
    assert.match(readFileSync(join(f.store.directory(parent.id), 'changes.patch'), 'utf8'), /a\+b/);
    assert.match(readFileSync('examples/repair/repo/add.cjs', 'utf8'), /a - b/);
  } finally { f.cleanup(); }
});

test('Search has no winner when all candidates fail and never overwrites destination conflict', async () => {
  const f = fixture();
  try {
    const adapter: Adapter = { id: 'all-fail', next: async () => ({ decision: completion }) };
    const parent = createRun(f.store, f.task, adapter);
    const result = await execute(f.store, parent.id, adapter, undefined, undefined, localChecks);
    assert.equal(result.status, 'failed'); assert.equal(result.searchState!.winner, undefined);
    assert.match(readFileSync(join(f.store.directory(parent.id), 'workspace/add.cjs'), 'utf8'), /a - b/);
    let parentId = '';
    const conflict: Adapter = { id: 'conflict', next: async (run) => {
      if (run.decisionIndex === 0) return { decision: { remainingPlan: ['Fix'], reason: 'Repair',
        action: { type: 'write', path: 'add.cjs', content: 'exports.add=(a,b)=>a+b;\n' } } };
      writeFileSync(join(f.store.directory(parentId), 'workspace/add.cjs'), 'USER CHANGE');
      return { decision: completion };
    } };
    const changed = createRun(f.store, f.task, conflict); parentId = changed.id;
    const stopped = await execute(f.store, changed.id, conflict, undefined, undefined, localChecks);
    assert.equal(stopped.status, 'paused'); assert.match(stopped.message, /Workspace changed/);
    assert.equal(readFileSync(join(f.store.directory(parentId), 'workspace/add.cjs'), 'utf8'), 'USER CHANGE');
  } finally { f.cleanup(); }
});
