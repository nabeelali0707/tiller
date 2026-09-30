import { z } from 'zod';
import type { Adapter, AdapterReply, Run } from '../core/contracts.js';
import { instructions, contextFor } from './prompt.js';

const envelope = z.object({
  status: z.string(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(),
  }).passthrough()),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).nullish(),
}).passthrough();

export class OpenAIAdapter implements Adapter {
  readonly id: string;
  constructor(private model: string, private apiKey: string, private request: typeof fetch = fetch) {
    if (!model.trim()) throw new Error('Set TILLER_MODEL or supply --model');
    if (!apiKey.trim()) throw new Error('Set OPENAI_API_KEY in your environment; do not put it in task files');
    this.id = `openai-responses:${model}`;
  }
  async next(run: Readonly<Run>, signal: AbortSignal): Promise<AdapterReply> {
    const response = await this.request('https://api.openai.com/v1/responses', {
      method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model, store: false, instructions: instructions(run),
        max_output_tokens: run.task.budget.maxOutputTokensPerCall,
        text: { format: { type: 'json_object' } },
        input: JSON.stringify(contextFor(run)),
      }),
    });
    // Never persist API error bodies, which can echo request data or credentials.
    if (!response.ok) { await response.body?.cancel(); throw new Error(`OpenAI request failed (HTTP ${response.status}); no automatic retry`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('OpenAI returned an empty body');
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 1_000_000) { await reader.cancel(); throw new Error('Provider response exceeded 1 MB'); }
      chunks.push(item.value);
    }
    const parsed = envelope.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) throw new Error('Malformed OpenAI response envelope');
    const body = parsed.data;
    const usage = body.usage ? { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens } : undefined;
    // Return malformed/incomplete decisions to the runtime so known usage is still charged.
    let decision: unknown = null;
    if (body.status === 'completed') {
      const text = body.output.filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? []).filter((part) => part.type === 'output_text').map((part) => part.text ?? '').join('');
      try { decision = JSON.parse(text) as unknown; } catch { /* runtime rejects without tool execution */ }
    }
    return usage ? { decision, usage } : { decision };
  }
}
