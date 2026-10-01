import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { ScriptedAdapter } from '../src/adapters/scripted.js';
import { createRun, execute, reconcileRun } from '../src/executors/runtime.js';
import { taskSchema } from '../src/core/contracts.js';
import type { Adapter, Decision, Task } from '../src/core/contracts.js';

const complete: Decision = { remainingPlan: ['Verify'], reason: 'Claim completion', action: { type: 'complete', summary: 'Done' } };
const repair: Decision = { remainingPlan: ['Fix', 'Verify'], reason: 'Fix subtraction', action: { type: 'write', path: 'add.cjs', content: 'exports.add=(a,b)=>a+b;\n' } };

function fixture(options: Partial<Task['budget']> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-runtime-'));
  const repo = join(dir, 'repo'); mkdirSync(repo);
  writeFileSync(join(repo, 'add.cjs'), 'exports.add=(a,b)=>a-b;\n');
  writeFileSync(join(repo, 'test.cjs'), "const {add}=require('./add.cjs'); require('node:assert/strict').equal(add(2,3),5);\n");
  const task = taskSchema.parse({ version: 1, goal: 'Fix addition', repository: repo,
    files: ['add.cjs', 'test.cjs'], editable: ['add.cjs'], checks: [{ id: 'test', command: 'node', args: ['test.cjs'], timeoutMs: 5000 }], budget: options });
  const store = new Store(join(dir, 'data'));
  return { dir, repo, task, store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('real failing check, repair, fresh verification, durable trace and patch; source untouched', async () => {
  const f = fixture();
  try {
    const adapter = new ScriptedAdapter([repair, complete]);
    const run = createRun(f.store, f.task, adapter);
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'succeeded'); assert.equal(result.calls, 2); assert.equal(result.tools, 3);
    assert.match(readFileSync(join(f.repo, 'add.cjs'), 'utf8'), /a-b/);
    assert.match(readFileSync(join(f.store.directory(run.id), 'changes.patch'), 'utf8'), /\+exports.add=\(a,b\)=>a\+b/);
    const events = f.store.events(run.id);
    const checks = events.filter((e) => e.type === 'operation.completed').map((e) => e.data as { result: { passed?: boolean } });
    assert.equal(checks[0]?.result.passed, false); assert.equal(checks.at(-1)?.result.passed, true);
    assert.equal(f.store.load(run.id).status, 'succeeded');
    await assert.rejects(execute(f.store, run.id, adapter), /Cannot resume succeeded/);
  } finally { f.cleanup(); }
});

test('a durable accepted action that has not started is dispatched on resume without skipping it or charging a new model call', async () => {
  const f = fixture();
  try {
    const adapter = new ScriptedAdapter([repair, complete]);
    const run = createRun(f.store, f.task, adapter);
    // Reconstruct the exact checkpoint between decision acceptance and tool intent.
    run.status = 'paused'; run.deadline = Date.now() + 60000; run.baselineDone = true;
    run.calls = 1; run.decisionIndex = 1; run.queuedAction = repair.action as NonNullable<typeof run.queuedAction>;
    f.store.save(run, 'action.proposed', repair);
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'succeeded', result.message); assert.equal(result.calls, 2);
    assert.equal(result.queuedAction, undefined); assert.equal(result.pending, null);
    const completed = f.store.events(run.id).filter((event) => event.type === 'operation.completed');
    assert.equal(completed.length, 2); // queued write, then real final check
  } finally { f.cleanup(); }
});

test('false completion is rejected and subsequent replanning can repair', async () => {
  const f = fixture();
  try {
    const adapter = new ScriptedAdapter([complete, repair, complete]);
    const run = createRun(f.store, f.task, adapter);
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'succeeded'); assert.equal(result.calls, 3);
    assert.ok(f.store.events(run.id).some((e) => e.type === 'verification.failed'));
    assert.equal(result.planVersion, 3);
  } finally { f.cleanup(); }
});

test('repeated false completion exhausts shared call budget', async () => {
  const f = fixture({ maxModelCalls: 2 });
  try {
    const adapter = new ScriptedAdapter([complete, complete, repair]);
    const run = createRun(f.store, f.task, adapter);
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'budget_exhausted'); assert.equal(result.calls, 2);
    assert.equal(result.tools, 3);
  } finally { f.cleanup(); }
});

test('interrupted write requires explicit reconciliation; resume keeps charges and script position', async () => {
  const f = fixture();
  try {
    const adapter = new ScriptedAdapter([repair, complete]);
    const run = createRun(f.store, f.task, adapter);
    run.status = 'running'; run.calls = 1; run.tools = 2; run.decisionIndex = 1; run.baselineDone = true;
    run.deadline = Date.now() + 60_000;
    run.pending = { id: 'crash-simulation', kind: 'write', detail: repair.action };
    f.store.save(run, 'operation.started', run.pending);
    writeFileSync(join(f.store.directory(run.id), 'workspace', 'add.cjs'), repair.action.type === 'write' ? repair.action.content : '');
    const blocked = await execute(f.store, run.id, adapter);
    assert.equal(blocked.status, 'paused'); assert.equal(blocked.calls, 1);
    const reconciled = reconcileRun(f.store, run.id);
    assert.equal(reconciled.tools, 2); assert.equal(reconciled.deadline, run.deadline);
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'succeeded'); assert.equal(result.calls, 2); assert.equal(result.tools, 3);
  } finally { f.cleanup(); }
});

test('out-of-band edits block dispatch, protected edits cannot be reconciled', async () => {
  const f = fixture();
  try {
    const adapter = new ScriptedAdapter([complete]);
    const run = createRun(f.store, f.task, adapter);
    writeFileSync(join(f.store.directory(run.id), 'workspace', 'test.cjs'), 'process.exit(0)');
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'paused'); assert.equal(result.calls, 0);
    assert.throws(() => reconcileRun(f.store, run.id), /Protected/);
  } finally { f.cleanup(); }
});

test('pending cancellation starts no model or checks', async () => {
  const f = fixture();
  try {
    const adapter = new ScriptedAdapter([repair, complete]);
    const run = createRun(f.store, f.task, adapter); f.store.cancel(run.id);
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'cancelled'); assert.equal(result.calls, 0); assert.equal(result.tools, 0);
  } finally { f.cleanup(); }
});

test('active cancellation aborts adapter and preserves unknown charged request', async () => {
  const f = fixture();
  try {
    let id = '';
    const adapter: Adapter = { id: 'cancel-test', next: async (_run, signal) => {
      f.store.cancel(id);
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      throw new Error('unreachable');
    } };
    const run = createRun(f.store, f.task, adapter); id = run.id;
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'cancelled'); assert.equal(result.calls, 1); assert.equal(result.unknownUsageCalls, 1);
    assert.equal(result.pending?.kind, 'model');
  } finally { f.cleanup(); }
});

test('malformed model output never reaches tools and consumes call budget', async () => {
  const f = fixture({ maxModelCalls: 2 });
  try {
    const adapter: Adapter = { id: 'bad-json', next: async () => ({ decision: { action: { type: 'shell' } }, usage: { inputTokens: 5, outputTokens: 3 } }) };
    const run = createRun(f.store, f.task, adapter);
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'budget_exhausted'); assert.equal(result.tools, 1);
    assert.equal(result.inputTokens, 10); assert.equal(result.outputTokens, 6); assert.equal(result.unknownUsageCalls, 0);
  } finally { f.cleanup(); }
});

test('expired resumed run receives no fresh duration or call budget', async () => {
  const f = fixture();
  try {
    const adapter = new ScriptedAdapter([complete]);
    const run = createRun(f.store, f.task, adapter);
    run.status = 'paused'; run.calls = 1; run.deadline = Date.now() - 1;
    f.store.save(run, 'run.paused');
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'budget_exhausted'); assert.equal(result.calls, 1); assert.equal(result.tools, 0);
  } finally { f.cleanup(); }
});

test('checks that modify declared inputs cannot certify their own output', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'test.cjs'), "require('node:fs').writeFileSync('add.cjs','exports.add=(a,b)=>a+b;');");
    const adapter = new ScriptedAdapter([complete]);
    const run = createRun(f.store, f.task, adapter);
    const result = await execute(f.store, run.id, adapter);
    assert.equal(result.status, 'paused'); assert.equal(result.calls, 0);
    assert.equal(result.pending?.kind, 'check');
  } finally { f.cleanup(); }
});
