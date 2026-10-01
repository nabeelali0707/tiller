import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Store } from '../src/storage/store.js';
import { taskSchema } from '../src/core/contracts.js';
import { ScriptedAdapter } from '../src/adapters/scripted.js';
import { createRun } from '../src/executors/runtime.js';
import { startDashboard } from '../src/interfaces/dashboard.js';
import { scopedTask } from '../src/interfaces/service.js';
import { redact, masked } from '../src/security/redaction.js';

test('dashboard requires bearer and correct origin, masks secrets and requests durable cancellation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-ui-')); const store = new Store(dir);
  const task = taskSchema.parse({ ...JSON.parse(readFileSync('examples/repair/task.json', 'utf8')),
    repository: resolve('examples/repair/repo'), goal: 'Fix <script>alert(1)</script> api_key=sentinel-secret-value' });
  const run = createRun(store, task, ScriptedAdapter.fromFile('examples/repair/script.json'));
  const dashboard = await startDashboard(store); const url = new URL(dashboard.url);
  const headers = { Authorization: `Bearer ${url.hash.slice(1)}` };
  try {
    assert.equal((await fetch(`${url.origin}/api/runs`)).status, 401);
    assert.equal((await fetch(`${url.origin}/api/runs`, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    const hostStatus = await new Promise<number>((done, reject) => {
      get(`${url.origin}/api/runs`, { headers: { ...headers, Host: 'evil.example' } }, (response) => {
        response.resume(); done(response.statusCode!);
      }).on('error', reject);
    });
    assert.equal(hostStatus, 403);
    const list = await (await fetch(`${url.origin}/api/runs`, { headers })).text();
    assert.match(list, /REDACTED/); assert.doesNotMatch(list, /sentinel-secret-value/);
    const asset = await (await fetch(`${url.origin}/app.js`)).text();
    assert.doesNotMatch(asset, /innerHTML/); assert.match(asset, /textContent/);
    const page = await fetch(url.origin); assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal((await fetch(`${url.origin}/api/runs/${run.id}/patch`, { headers })).status, 404);
    assert.equal((await fetch(`${url.origin}/api/runs/${run.id}/cancel`, { method: 'POST', headers })).status, 200);
    assert.equal(store.cancelled(run.id), true);
    assert.equal((await fetch(`${url.origin}/api/runs/${run.id}/events`, { headers })).status, 200);
  } finally { await new Promise<void>((done) => dashboard.server.close(() => done())); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('MCP negotiates over real stdio, exposes scoped tools, and inspects a persisted run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-mcp-'));
  const store = new Store(dir);
  const task = taskSchema.parse({ ...JSON.parse(readFileSync('examples/repair/task.json', 'utf8')), repository: resolve('examples/repair/repo') });
  const run = createRun(store, task, ScriptedAdapter.fromFile('examples/repair/script.json')); store.close();
  const client = new Client({ name: 'tiller-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve('dist/src/cli.js'), 'mcp', '--data-dir', dir, '--workspace', resolve('.')], stderr: 'pipe' });
  try {
    await client.connect(transport);
    const listing = await client.listTools(); assert.equal(listing.tools.length, 7);
    const inspect = await client.callTool({ name: 'get_run', arguments: { runId: run.id } });
    assert.match(JSON.stringify(inspect), /No verified completion/);
    const blocked = await client.callTool({ name: 'start_run', arguments: { taskFile: 'examples/repair/task.json' } });
    assert.equal(blocked.isError, true);
    const outside = await client.callTool({ name: 'start_run', arguments: { taskFile: '../outside.json' } });
    assert.equal(outside.isError, true);
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('integration scope and structured redaction preserve data shape without granting broader access', () => {
  assert.throws(() => scopedTask(resolve('.'), '../outside.json'));
  const task = scopedTask(resolve('.'), 'examples/search/task.json'); assert.equal(task.execution!.mode, 'docker');
  assert.deepEqual(masked({ api_key: 'secret', nested: ['Bearer abc.def', 'a "quoted" string'] }),
    { api_key: '[REDACTED]', nested: ['Bearer [REDACTED]', 'a "quoted" string'] });
  assert.equal(redact('https://example.test?sig=abc&name=x'), 'https://example.test?sig=[REDACTED]&name=x');
});
