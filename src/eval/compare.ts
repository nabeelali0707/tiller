import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, Status, Task } from '../core/contracts.js';
import { createRun, execute } from '../executors/runtime.js';
import { Store } from '../storage/store.js';

export type Strategy = Task['strategy'];
export const strategies: Strategy[] = ['flat-react', 'plan-react', 'sequential', 'hierarchical'];
export interface ComparisonRow {
  strategy: Strategy; repeat: number; runId: string; adapter: string; outcome: Status;
  accepted: boolean; modelCalls: number; toolCalls: number; inputTokens: number;
  outputTokens: number; unknownUsageCalls: number; elapsedMs: number;
}
export interface ComparisonReport {
  version: 1; id: string; status: 'running' | 'completed' | 'interrupted';
  task: Task; startedAt: string; inputHashes: Record<string, string> | null;
  conditions: Strategy[]; repeats: number; rows: ComparisonRow[]; error: string | null;
  notes: string[];
}

export async function compare(store: Store, task: Task, conditions: Strategy[], repeats: number,
  adapterFor: (strategy: Strategy) => Adapter, signal?: AbortSignal): Promise<{ path: string; report: ComparisonReport }> {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Repeats must be an integer from 1 to 10');
  if (!conditions.length || new Set(conditions).size !== conditions.length || conditions.some((c) => !strategies.includes(c)))
    throw new Error('Choose unique supported strategies');
  // Validate all adapter configurations before any environment is executed.
  const adapters = new Map(conditions.map((condition) => [condition, adapterFor(condition)]));
  const id = randomUUID();
  const dir = join(store.root, 'comparisons', id); mkdirSync(dir, { recursive: true });
  const path = join(dir, 'report.json');
  const report: ComparisonReport = { version: 1, id, status: 'running', task, startedAt: new Date().toISOString(),
    inputHashes: null, conditions, repeats, rows: [], error: null,
    notes: ['One task fixture; not a benchmark or evidence of general superiority.',
      'All conditions share inputs, tools, acceptance checks and configured budget caps. Actual resource use may differ.',
      'Planning and leaf verification count against run budgets. Checks are visible, not hidden evaluation tests.',
      'Condition order rotates across repeats; model cache/load time still affects measured latency.',
      'Scripted adapters exercise control flow only. Model calls for scripts are decision counts, with zero tokens.'],
  };
  const save = () => { writeFileSync(path + '.tmp', JSON.stringify(report, null, 2) + '\n'); renameSync(path + '.tmp', path); };
  save();
  try {
    for (let repeat = 0; repeat < repeats; repeat++) {
      const offset = repeat % conditions.length;
      const ordered = [...conditions.slice(offset), ...conditions.slice(0, offset)];
      for (const strategy of ordered) {
        signal?.throwIfAborted();
        const adapter = adapters.get(strategy)!;
        const started = Date.now();
        const run = createRun(store, { ...task, strategy }, adapter);
        report.inputHashes ??= run.hashes;
        if (JSON.stringify(report.inputHashes) !== JSON.stringify(run.hashes)) throw new Error('Input files changed between conditions; comparison interrupted');
        const result = await execute(store, run.id, adapter, signal);
        report.rows.push({ strategy, repeat: repeat + 1, runId: run.id, adapter: adapter.id, outcome: result.status,
          accepted: result.status === 'succeeded', modelCalls: result.calls, toolCalls: result.tools,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens, unknownUsageCalls: result.unknownUsageCalls,
          elapsedMs: Date.now() - started });
        save();
        signal?.throwIfAborted();
      }
    }
    report.status = 'completed';
  } catch (error) {
    report.status = 'interrupted'; report.error = error instanceof Error ? error.message : 'Interrupted';
  }
  save();
  return { path, report };
}
