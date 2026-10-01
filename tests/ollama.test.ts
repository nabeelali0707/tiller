import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaAdapter } from '../src/adapters/ollama.js';
import { taskSchema } from '../src/core/contracts.js';
import type { Run } from '../src/core/contracts.js';
import { createServer } from 'node:http';

const run = { task: taskSchema.parse({ version: 1, goal: 'repair', repository: '.', files: ['a'], editable: ['a'], checks: [{ id: 'test', command: 'node', args: [] }] }),
  remainingPlan: [], observations: [], calls: 1 } as unknown as Run;
const decision = { remainingPlan: ['Verify'], reason: 'Ready', action: { type: 'complete', summary: 'Done' } };

test('default Ollama transport reaches a real loopback HTTP server', async () => {
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume request */ }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ done: true, message: { content: JSON.stringify(decision) }, prompt_eval_count: 2, eval_count: 3 }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const result = await new OllamaAdapter('local', `http://127.0.0.1:${address.port}`).next(run, AbortSignal.timeout(5000));
    assert.deepEqual(result.decision, decision);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('Ollama uses a loopback nonstreaming schema request and accounts local tokens', async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(init?.body as string);
    assert.equal(body.stream, false); assert.equal(body.options.num_predict, 4096);
    assert.equal(body.format.type, 'object'); assert.equal(body.options.temperature, 0);
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    return Response.json({ done: true, done_reason: 'stop', message: { content: JSON.stringify(decision) }, prompt_eval_count: 12, eval_count: 8 });
  };
  const result = await new OllamaAdapter('local-model', undefined, request).next(run, new AbortController().signal);
  assert.deepEqual(result.decision, decision); assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8 });
});
test('Ollama rejects remote endpoints, cloud names, and truncated output', async () => {
  for (const url of ['https://example.com', 'http://localhost:11434', 'http://127.0.0.1:11434/other', 'http://user:pass@127.0.0.1:11434'])
    assert.throws(() => new OllamaAdapter('local', url), /loopback/);
  assert.throws(() => new OllamaAdapter('qwen3.5:cloud'), /Cloud/);
  const adapter = new OllamaAdapter('local', undefined, async () => Response.json({ done: true, done_reason: 'length', message: { content: JSON.stringify(decision) }, prompt_eval_count: 8, eval_count: 4096 }));
  const result = await adapter.next(run, new AbortController().signal);
  assert.equal(result.decision, null); assert.equal(result.usage?.outputTokens, 4096);
});

test('explicit thinking configuration is sent and preserved in adapter identity', async () => {
  const adapter = new OllamaAdapter('lfm2.5:8b', undefined, async (_url, init) => {
    assert.equal(JSON.parse(init!.body as string).think, false);
    return Response.json({ done: true, message: { content: JSON.stringify(decision) }, prompt_eval_count: 2, eval_count: 3 });
  }, { think: false });
  assert.match(adapter.id, /think=false$/);
  await adapter.next(run, new AbortController().signal);
});
