import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIAdapter } from '../src/adapters/openai.js';
import { ScriptedAdapter } from '../src/adapters/scripted.js';
import type { Run } from '../src/core/contracts.js';
import { taskSchema } from '../src/core/contracts.js';

const decision = { remainingPlan: ['Verify'], reason: 'Ready for checks', action: { type: 'complete', summary: 'Done' } };
const run = { task: taskSchema.parse({ version: 1, goal: 'repair', repository: '.', files: ['a'], editable: ['a'], checks: [{ id: 'test', command: 'node', args: [] }] }),
  remainingPlan: [], observations: [], calls: 1, decisionIndex: 0 } as unknown as Run;

test('Responses adapter sends bounded JSON request and collects known usage', async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    assert.equal(body.store, false); assert.equal(body.max_output_tokens, 4096);
    assert.deepEqual(body.text, { format: { type: 'json_object' } });
    assert.ok(init?.signal); assert.equal(init?.redirect, 'error');
    return Response.json({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(decision) }] }], usage: { input_tokens: 100, output_tokens: 20 } });
  };
  const adapter = new OpenAIAdapter('test-model', 'test-key', request);
  const result = await adapter.next(run, new AbortController().signal);
  assert.deepEqual(result.decision, decision);
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 20 });
});
test('incomplete and refused responses do not become completion decisions', async () => {
  for (const payload of [
    { status: 'incomplete', output: [], usage: { input_tokens: 5, output_tokens: 8 } },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] },
  ]) {
    const adapter = new OpenAIAdapter('test-model', 'test-key', async () => Response.json(payload));
    assert.equal((await adapter.next(run, new AbortController().signal)).decision, null);
  }
});
test('provider errors do not expose response bodies and are not retried', async () => {
  let requests = 0;
  const adapter = new OpenAIAdapter('test-model', 'test-key', async () => {
    requests++; return new Response('sensitive error echoed here', { status: 429 });
  });
  await assert.rejects(adapter.next(run, new AbortController().signal), /^Error: OpenAI request failed \(HTTP 429\); no automatic retry$/);
  assert.equal(requests, 1);
});
test('script identity changes when decisions change and exhaustion is explicit', async () => {
  const adapter = new ScriptedAdapter([decision]);
  assert.notEqual(adapter.id, new ScriptedAdapter([{ ...decision, reason: 'Other' }]).id);
  await assert.rejects(adapter.next({ ...run, decisionIndex: 1 }, new AbortController().signal), /exhausted/);
});
