import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/store.js';
import { taskSchema } from '../src/core/contracts.js';
import { createRun } from '../src/executors/runtime.js';
import { ScriptedAdapter } from '../src/adapters/scripted.js';
const backend = createRequire(import.meta.url)(resolve('integrations/vscode/backend.cjs')) as {
  invoke(node: string, cli: string, root: string, data: string, command: string, id?: string): Promise<string>;
  eventSummary(event: unknown): string;
};
test('editor backend reads real CLI state and cannot dispatch agent execution or arbitrary arguments', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-editor-')); const store = new Store(dir);
  try {
    const task = taskSchema.parse({ ...JSON.parse(readFileSync('examples/repair/task.json', 'utf8')), repository: resolve('examples/repair/repo') });
    const run = createRun(store, task, ScriptedAdapter.fromFile('examples/repair/script.json'));
    const call = (command: string, id?: string) => backend.invoke(process.execPath, resolve('dist/src/cli.js'), resolve('.'), dir, command, id);
    const list = JSON.parse(await call('list'));
    assert.equal(list[0].id, run.id); assert.equal(list[0].acceptance, 'No verified completion');
    assert.equal(JSON.parse(await call('inspect', run.id)).status, 'ready');
    const events = (await call('trace', run.id)).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(backend.eventSummary(events[0]), 'run.created');
    await assert.rejects(call('run', run.id), /Unsupported/);
    await assert.rejects(call('trace', '--model=bad'), /valid run/);
    await call('cancel', run.id); assert.equal(store.cancelled(run.id), true);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
