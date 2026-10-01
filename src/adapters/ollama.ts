import { z } from 'zod';
import type { Adapter, AdapterReply, Run } from '../core/contracts.js';
import { instructions, contextFor } from './prompt.js';
import { decisionSchema } from '../core/contracts.js';
import { Agent, fetch as transportFetch } from 'undici';

// Cold local inference can exceed Node's default 5-minute header timeout.
// The runtime's abort signal/deadline remains the hard request limit.
const localDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 5000, pipelining: 0 });
// Keep fetch and its dispatcher on the same Undici version.
const localFetch: typeof fetch = (input, init) => transportFetch(input as string, { ...init, dispatcher: localDispatcher } as Parameters<typeof transportFetch>[1]) as unknown as Promise<Response>;

const envelope = z.object({
  done: z.boolean(), done_reason: z.string().optional(),
  message: z.object({ content: z.string() }).passthrough(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
}).passthrough();

export class OllamaAdapter implements Adapter {
  readonly id: string;
  readonly endpoint: string;
  constructor(private model: string, endpoint = 'http://127.0.0.1:11434', private request: typeof fetch = localFetch, private options: { think?: boolean } = {}) {
    if (!model.trim()) throw new Error('Choose an installed local model with --model or TILLER_MODEL');
    if (/(?:^|[-:])cloud(?:$|[-:])/i.test(model)) throw new Error('Cloud models are not supported by the local Ollama adapter');
    const url = new URL(endpoint);
    if (!['127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw new Error('Ollama endpoint must be an HTTP loopback IP (127.0.0.1 or [::1]), with no credentials or path');
    this.endpoint = url.origin;
    this.id = `ollama:${this.endpoint}:${model}${options.think === undefined ? '' : `:think=${options.think}`}`;
  }
  async next(run: Readonly<Run>, signal: AbortSignal): Promise<AdapterReply> {
    let response: Response;
    try {
      response = await this.request(`${this.endpoint}/api/chat`, {
        method: 'POST', signal, redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: false, keep_alive: '2m',
          ...(this.options.think === undefined ? {} : { think: this.options.think }),
          format: z.toJSONSchema(decisionSchema),
          options: { temperature: 0, num_predict: run.task.budget.maxOutputTokensPerCall, num_ctx: 8192 },
          messages: [{ role: 'system', content: instructions(run) }, { role: 'user', content: JSON.stringify(contextFor(run)) }],
        }),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      const code = (error as { cause?: { code?: string } }).cause?.code;
      throw new Error(code === 'UND_ERR_HEADERS_TIMEOUT' ? 'Local Ollama response timed out before headers arrived'
        : 'Local Ollama connection failed during inference; check server availability and request limits');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Ollama request failed (HTTP ${response.status}); check the installed model and local server`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Ollama returned an empty response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > 1_000_000) { await reader.cancel(); throw new Error('Ollama response exceeded 1 MB'); }
      chunks.push(item.value);
    }
    let payload: unknown;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Malformed Ollama JSON response'); }
    const parsed = envelope.safeParse(payload);
    if (!parsed.success) throw new Error('Malformed Ollama response envelope');
    const body = parsed.data;
    let decision: unknown = null;
    if (body.done && body.done_reason !== 'length') {
      // Some local model templates return a leading thinking wrapper in content
      // even when think=false. Accept only a closed prefix and strict final JSON;
      // never extract a JSON-looking substring from arbitrary model commentary.
      let content = body.message.content.trim();
      if (content.startsWith('<think>')) {
        const end = content.indexOf('</think>', 7);
        content = end < 0 ? '' : content.slice(end + 8).trim();
      }
      try { decision = JSON.parse(content); } catch { /* charged, then rejected by runtime */ }
    }
    const usage = body.prompt_eval_count !== undefined && body.eval_count !== undefined ?
      { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count } : undefined;
    return usage ? { decision, usage } : { decision };
  }
}
