import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/store.js';
import { evaluateSuite } from '../src/eval/suite.js';
import { ScriptedAdapter } from '../src/adapters/scripted.js';

test('independent evaluation rejects an overfit visible-check success without feeding oracle to the agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-oracle-')); const store = new Store(join(dir, 'data'));
  try {
    for (const folder of ['repo', 'oracle']) mkdirSync(join(dir, folder));
    writeFileSync(join(dir, 'repo/add.cjs'), 'exports.add=(a,b)=>a-b;');
    writeFileSync(join(dir, 'repo/visible.cjs'), "require('node:assert/strict').equal(require('./add.cjs').add(2,3),5);");
    writeFileSync(join(dir, 'oracle/private.cjs'), "require('node:assert/strict').equal(require('./add.cjs').add(-1,3),2);");
    writeFileSync(join(dir, 'task.json'), JSON.stringify({ version: 1, goal: 'Repair addition', repository: './repo',
      files: ['add.cjs', 'visible.cjs'], editable: ['add.cjs'], checks: [{ id: 'visible', command: 'node', args: ['visible.cjs'] }] }));
    writeFileSync(join(dir, 'script.json'), JSON.stringify([
      { reason: 'Overfit visible input', remainingPlan: ['Write', 'Verify'], action: { type: 'write', path: 'add.cjs', content: 'exports.add=()=>5;' } },
      { reason: 'Request checks', remainingPlan: ['Verify'], action: { type: 'complete', summary: 'Visible case passes' } },
    ]));
    writeFileSync(join(dir, 'suite.json'), JSON.stringify({ version: 1, name: 'independent evaluation', cases: [{
      id: 'addition', task: 'task.json', scripts: { sequential: 'script.json' },
      oracle: { repository: 'oracle', files: ['private.cjs'], checks: [{ id: 'private', command: 'node', args: ['private.cjs'] }] },
    }] }));
    const result = await evaluateSuite(store, join(dir, 'suite.json'), ['sequential'], 1,
      (_strategy, script) => {
        const adapter = ScriptedAdapter.fromFile(script!);
        return { id: adapter.id, next: async (run, signal) => {
          assert.equal(JSON.stringify(run).includes('private.cjs'), false);
          return adapter.next(run, signal);
        } };
      }, true);
    assert.equal(result.report.status, 'completed');
    const row = result.report.results[0]!;
    assert.equal(row.report.rows[0]!.accepted, true);
    assert.equal(row.evaluations![0]!.passed, false);
    const run = store.load(row.report.rows[0]!.runId);
    assert.equal(run.status, 'succeeded'); assert.equal(run.tools, 3);
    assert.equal(row.evaluations![0]!.evaluationToolCalls, 1);
    assert.doesNotMatch(JSON.stringify(store.events(run.id)), /private.cjs/);
    assert.equal(readFileSync(join(dir, 'repo/add.cjs'), 'utf8'), 'exports.add=(a,b)=>a-b;');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
