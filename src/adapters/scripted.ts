import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { decisionSchema } from '../core/contracts.js';
import type { Adapter, AdapterReply, Decision, Run } from '../core/contracts.js';
import { hash } from '../tools/workspace.js';

export class ScriptedAdapter implements Adapter {
  readonly id: string;
  private decisions: Decision[];
  constructor(decisions: unknown) {
    this.decisions = z.array(decisionSchema).min(1).max(100).parse(decisions);
    this.id = `scripted:${hash(JSON.stringify(this.decisions))}`;
  }
  static fromFile(path: string): ScriptedAdapter {
    return new ScriptedAdapter(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  }
  async next(run: Readonly<Run>, signal: AbortSignal): Promise<AdapterReply> {
    signal.throwIfAborted();
    const decision = this.decisions[run.decisionIndex];
    if (!decision) throw new Error('Script exhausted before verified completion');
    return { decision, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
