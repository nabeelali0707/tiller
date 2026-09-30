import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildHierarchy, completeLeaf, nextLeaf, invalidateChecks } from '../src/core/hierarchy.js';
import type { PlanNode } from '../src/core/hierarchy.js';
import { Store } from '../src/storage/store.js';
import { ScriptedAdapter } from '../src/adapters/scripted.js';
import { taskSchema } from '../src/core/contracts.js';
import { createRun, execute, reconcileRun } from '../src/executors/runtime.js';

const script = JSON.parse(readFileSync('examples/hierarchical/script.json', 'utf8'));
const nodes = script[0].action.nodes as PlanNode[];
const tree = () => buildHierarchy(nodes, ['add.cjs'], ['addition']);

test('hierarchy validation rejects impossible structures and unknown acceptance references', () => {
  const invalid = (mutate: (n: PlanNode[]) => void) => {
    const n = structuredClone(nodes); mutate(n);
    assert.throws(() => buildHierarchy(n, ['add.cjs'], ['addition']));
  };
  invalid((n) => { n[2]!.id = n[1]!.id; });
  invalid((n) => { n[1]!.parentId = null; });
  invalid((n) => { n[1]!.parentId = 'missing'; });
  invalid((n) => { n[1]!.parentId = 'repair'; n[2]!.parentId = 'inspect'; });
  invalid((n) => { n[1]!.dependsOn = ['repair']; });
  invalid((n) => { n[1]!.dependsOn = ['root']; });
  invalid((n) => { n[1]!.acceptance = { type: 'checks', checkIds: ['unknown'] }; });
  invalid((n) => { n[1]!.acceptance = { type: 'read', paths: ['../outside'] }; });
  invalid((n) => { n[0]!.acceptance = { type: 'read', paths: ['add.cjs'] }; });
  const deep: PlanNode[] = [];
  for (let i = 0; i < 5; i++) {
    deep.push({ id: `p${i}`, parentId: i === 0 ? null : `p${i - 1}`, goal: 'parent', dependsOn: [], acceptance: { type: 'children' } });
    deep.push({ id: `l${i}`, parentId: `p${i}`, goal: 'read', dependsOn: [], acceptance: { type: 'read', paths: ['add.cjs'] } });
  }
  assert.throws(() => buildHierarchy(deep, ['add.cjs'], ['addition']), /depth|children/);
  assert.throws(() => buildHierarchy(Array.from({ length: 25 }, () => nodes[1]), ['add.cjs'], ['addition']));
});

test('scheduler enforces prerequisites and aggregates parents only after children', () => {
  const t = tree();
  assert.equal(nextLeaf(t)?.id, 'inspect');
  assert.deepEqual(completeLeaf(t, t.nodes[1]!, 'Read source'), ['inspect']);
  assert.equal(t.progress.root?.status, 'pending');
  assert.equal(nextLeaf(t)?.id, 'repair');
  assert.deepEqual(completeLeaf(t, t.nodes[2]!, 'Checks passed'), ['repair', 'root']);
  assert.equal(nextLeaf(t), undefined);
  assert.deepEqual(invalidateChecks(t), ['repair', 'root']);
  assert.equal(t.progress.inspect?.status, 'completed');
  assert.equal(nextLeaf(t)?.id, 'repair');
});

test('nested read-only parents remain satisfied after later repair writes', () => {
  const n = structuredClone(nodes);
  n[1]!.acceptance = { type: 'children' };
  n.push(...['readA', 'readB'].map((id) => ({ id, parentId: 'inspect', goal: 'Read', dependsOn: [], acceptance: { type: 'read' as const, paths: ['add.cjs'] } })));
  const t = buildHierarchy(n, ['add.cjs'], ['addition']);
  completeLeaf(t, t.nodes[3]!, 'Read A'); completeLeaf(t, t.nodes[4]!, 'Read B');
  assert.equal(t.progress.inspect?.status, 'completed');
  invalidateChecks(t);
  assert.equal(t.progress.inspect?.status, 'completed'); assert.equal(nextLeaf(t)?.id, 'repair');
});

function setup(decisions: unknown = script) {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-hierarchy-'));
  const store = new Store(dir);
  const task = taskSchema.parse({ ...JSON.parse(readFileSync('examples/hierarchical/task.json', 'utf8')), repository: resolve('examples/repair/repo') });
  const adapter = new ScriptedAdapter(decisions);
  const run = createRun(store, task, adapter);
  return { store, adapter, run, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('Hierarchical fixture records real leaf dispatch, acceptance and final verification', async () => {
  const f = setup();
  try {
    const result = await execute(f.store, f.run.id, f.adapter);
    assert.equal(result.status, 'succeeded'); assert.equal(result.calls, 5); assert.equal(result.tools, 5);
    assert.ok(Object.values(result.hierarchy!.progress).every((p) => p.status === 'completed'));
    const events = f.store.events(f.run.id);
    assert.deepEqual(events.filter((e) => e.type === 'node.dispatched').map((e) => (e.data as { nodeId: string }).nodeId), ['inspect', 'repair']);
    assert.ok(events.some((e) => e.type === 'node.completed'));
  } finally { f.cleanup(); }
});

test('wrong-node actions and premature read completion do not bypass prerequisites', async () => {
  const wrong = { ...script[3], nodeId: 'repair' };
  const f = setup([script[0], wrong, script[2], ...script.slice(1)]);
  try {
    const result = await execute(f.store, f.run.id, f.adapter);
    assert.equal(result.status, 'succeeded'); assert.equal(result.tools, 5);
    const events = f.store.events(f.run.id);
    assert.ok(events.some((e) => e.type === 'decision.rejected'));
    assert.ok(events.some((e) => e.type === 'node.completion_rejected'));
  } finally { f.cleanup(); }
});

test('failing repair checks keep dependent nodes and parents incomplete', async () => {
  const f = setup([script[0], script[1], script[2], script[4]]);
  try {
    const result = await execute(f.store, f.run.id, f.adapter);
    assert.equal(result.status, 'paused'); // script exhausts after failed leaf verification
    assert.notEqual(result.hierarchy!.progress.repair?.status, 'completed');
    assert.notEqual(result.hierarchy!.progress.root?.status, 'completed');
    assert.ok(f.store.events(f.run.id).some((e) => e.type === 'node.completion_rejected'));
  } finally { f.cleanup(); }
});

test('reconciliation invalidates completed check evidence while retaining reads and budgets', () => {
  const f = setup();
  try {
    f.run.hierarchy = tree();
    completeLeaf(f.run.hierarchy, f.run.hierarchy.nodes[1]!, 'Read');
    completeLeaf(f.run.hierarchy, f.run.hierarchy.nodes[2]!, 'Previously passed');
    f.run.status = 'paused'; f.run.calls = 4; f.run.tools = 4;
    f.store.save(f.run, 'run.paused');
    writeFileSync(join(f.store.directory(f.run.id), 'workspace', 'add.cjs'), 'exports.add=(a,b)=>a+b;');
    const reconciled = reconcileRun(f.store, f.run.id);
    assert.equal(reconciled.calls, 4); assert.equal(reconciled.tools, 4);
    assert.equal(reconciled.hierarchy!.progress.inspect?.status, 'completed');
    assert.equal(reconciled.hierarchy!.progress.repair?.status, 'pending');
  } finally { f.cleanup(); }
});
