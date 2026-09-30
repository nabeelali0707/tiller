import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { taskSchema, decisionSchema, transition, reserve, BudgetError } from '../src/core/contracts.js';
import type { Run } from '../src/core/contracts.js';
import { Store } from '../src/storage/store.js';

export function makeRun(): Run {
  return {
    version: 1, id: randomUUID(), task: taskSchema.parse({ version: 1, goal: 'Fix addition', repository: '.',
      files: ['add.js'], editable: ['add.js'], checks: [{ id: 'test', command: 'node', args: ['test.js'] }] }),
    adapter: 'script', status: 'ready', createdAt: Date.now(), deadline: null, calls: 0, tools: 0,
    inputTokens: 0, outputTokens: 0, unknownUsageCalls: 0, decisionIndex: 0,
    planVersion: 0, remainingPlan: [], pending: null, hashes: {}, baselineDone: false, observations: [], message: '',
  };
}
test('rejects invalid paths, missing checks, duplicate identities and undeclared edits', () => {
  const t = makeRun().task;
  for (const path of ['../escape', 'C:/escape', 'a\\b', '.git/config', 'CON.txt', 'a/../b', 'a:stream'])
    assert.throws(() => taskSchema.parse({ ...t, files: [path], editable: [path] }));
  assert.throws(() => taskSchema.parse({ ...t, checks: [] }));
  assert.throws(() => taskSchema.parse({ ...t, files: ['a', 'A'] }));
  assert.throws(() => taskSchema.parse({ ...t, editable: ['other'] }));
  assert.throws(() => decisionSchema.parse({ remainingPlan: ['x'], reason: 'x', action: { type: 'shell', command: 'anything' } }));
});
test('terminal success cannot resume and dispatch cannot directly succeed', () => {
  const run = makeRun();
  transition(run, 'running');
  assert.throws(() => transition(run, 'succeeded'));
  transition(run, 'verifying'); transition(run, 'succeeded');
  assert.throws(() => transition(run, 'running'));
});
test('reservations include failures and preserve final verification capacity', () => {
  const run = makeRun(); run.task.budget.maxToolCalls = 2; run.task.budget.maxModelCalls = 1;
  reserve(run, 'tool');
  assert.throws(() => reserve(run, 'tool'), BudgetError);
  reserve(run, 'tool', 1, true);
  reserve(run, 'model');
  assert.throws(() => reserve(run, 'model'), BudgetError);
  assert.equal(run.unknownUsageCalls, 1);
  run.deadline = Date.now() - 1;
  assert.throws(() => reserve(run, 'tool', 0, true), BudgetError);
});
test('state and ordered events persist together and cancellation survives state writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-store-'));
  const run = makeRun();
  try {
    let store = new Store(dir);
    store.save(run, 'created'); store.cancel(run.id);
    reserve(run, 'model'); store.save(run, 'reserved', { calls: 1 });
    const release = store.lock(run.id);
    assert.throws(() => store.lock(run.id), /already owned/); release(); store.close();
    store = new Store(dir);
    assert.equal(store.load(run.id).calls, 1);
    assert.equal(store.cancelled(run.id), true);
    assert.deepEqual(store.events(run.id).map((e) => e.type), ['created', 'reserved']);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
