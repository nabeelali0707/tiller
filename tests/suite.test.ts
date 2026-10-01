import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/storage/store.js';
import { ScriptedAdapter } from '../src/adapters/scripted.js';
import { strategies } from '../src/eval/compare.js';
import { evaluateSuite, suiteSchema } from '../src/eval/suite.js';

test('suite runs twelve independent conditions with real checks and preserves original fixtures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-suite-')); const store = new Store(dir);
  const paths = ['examples/repair/repo/add.cjs', 'examples/evaluation/validation/repo/discount.cjs',
    'examples/evaluation/dependencies/repo/normalize.cjs', 'examples/evaluation/dependencies/repo/lookup.cjs'];
  const originals = paths.map((path) => readFileSync(path, 'utf8'));
  try {
    const result = await evaluateSuite(store, 'examples/evaluation/suite.json', strategies, 1,
      (_strategy, script) => ScriptedAdapter.fromFile(script!), true);
    assert.equal(result.report.status, 'completed'); assert.equal(result.report.results.length, 3);
    const rows = result.report.results.flatMap((entry) => entry.report.rows);
    assert.equal(rows.length, 12); assert.ok(rows.every((row) => row.accepted));
    assert.equal(new Set(rows.map((row) => row.runId)).size, 12);
    for (const entry of result.report.results) {
      assert.equal(entry.report.status, 'completed');
      assert.deepEqual(JSON.parse(readFileSync(entry.path, 'utf8')), entry.report);
      for (const row of entry.report.rows) {
        const events = store.events(row.runId);
        const checks = events.filter((event) => event.type === 'operation.completed' &&
          (event.data as { operation?: { kind: string } }).operation?.kind === 'check');
        assert.ok(checks.length >= 2);
        assert.equal((checks[0]!.data as { result: { passed: boolean } }).result.passed, false);
        assert.equal((checks.at(-1)!.data as { result: { passed: boolean } }).result.passed, true);
      }
    }
    assert.deepEqual(JSON.parse(readFileSync(result.path, 'utf8')), result.report);
    assert.deepEqual(paths.map((path) => readFileSync(path, 'utf8')), originals);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('suite preflights every script mapping before dispatch and rejects duplicate cases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-suite-invalid-')); const store = new Store(dir);
  try {
    const file = join(dir, 'suite.json');
    writeFileSync(file, JSON.stringify({ version: 1, name: 'invalid', cases: [
      { id: 'first', task: resolve('examples/repair/task.json'), scripts: { sequential: resolve('examples/repair/script.json') } },
      { id: 'second', task: resolve('examples/repair/task.json') },
    ] }));
    let calls = 0;
    await assert.rejects(evaluateSuite(store, file, ['sequential'], 1, (_strategy, script) => {
      const adapter = ScriptedAdapter.fromFile(script!);
      return { id: adapter.id, next: async (run, signal) => { calls++; return adapter.next(run, signal); } };
    }, true), /Missing script for second/);
    assert.equal(calls, 0);
    assert.equal(suiteSchema.safeParse({ version: 1, name: 'duplicate', cases: [
      { id: 'a', task: 'a' }, { id: 'A', task: 'b' },
    ] }).success, false);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('suite retains interrupted case and stops before dispatching subsequent cases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-suite-interrupt-')); const store = new Store(dir);
  const controller = new AbortController(); let calls = 0;
  try {
    const result = await evaluateSuite(store, 'examples/evaluation/suite.json', ['sequential'], 1,
      (_strategy, script) => {
        const adapter = ScriptedAdapter.fromFile(script!);
        return { id: adapter.id, next: async (run, signal) => {
          calls++; const reply = await adapter.next(run, signal); controller.abort(); return reply;
        } };
      }, true, controller.signal);
    assert.equal(result.report.status, 'interrupted'); assert.equal(calls, 1);
    assert.equal(result.report.results.length, 1);
    assert.equal(result.report.results[0]!.report.rows[0]!.outcome, 'paused');
    assert.deepEqual(JSON.parse(readFileSync(result.path, 'utf8')), result.report);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('completed evaluation preserves failed run outcomes without treating them as accepted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-suite-failure-')); const store = new Store(dir);
  try {
    const source = JSON.parse(readFileSync('examples/repair/task.json', 'utf8'));
    source.repository = resolve('examples/repair/repo'); source.budget.maxModelCalls = 1;
    writeFileSync(join(dir, 'task.json'), JSON.stringify(source));
    const file = join(dir, 'suite.json');
    writeFileSync(file, JSON.stringify({ version: 1, name: 'failure', cases: [{ id: 'broken', task: 'task.json' }] }));
    const result = await evaluateSuite(store, file, ['sequential'], 1,
      () => ({ id: 'false-completion', next: async () => ({ decision: {
        reason: 'Claim completion without fixing the bug', remainingPlan: ['Verify'],
        action: { type: 'complete', summary: 'Unverified completion claim' },
      } }) }), false);
    assert.equal(result.report.status, 'completed');
    const row = result.report.results[0]!.report.rows[0]!;
    assert.equal(row.accepted, false); assert.equal(row.outcome, 'budget_exhausted');
    assert.equal(row.modelCalls, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
