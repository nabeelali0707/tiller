import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { taskSchema } from '../core/contracts.js';
import type { Adapter } from '../core/contracts.js';
import { Store } from '../storage/store.js';
import { compare, strategies } from './compare.js';
import type { ComparisonReport, Strategy } from './compare.js';

export const suiteSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(200),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80),
    task: z.string().min(1),
    scripts: z.partialRecord(z.enum(strategies as [Strategy, ...Strategy[]]), z.string().min(1)).optional(),
  }).strict()).min(1).max(20),
}).strict().refine((suite) => new Set(suite.cases.map((c) => c.id.toLowerCase())).size === suite.cases.length,
  'Case IDs must be unique (case-insensitive)');

export interface SuiteReport {
  version: 1; id: string; name: string; startedAt: string;
  status: 'running' | 'completed' | 'interrupted'; error: string | null;
  conditions: Strategy[]; repeats: number;
  results: { caseId: string; path: string; report: ComparisonReport }[];
  notes: string[];
}

export async function evaluateSuite(store: Store, file: string, conditions: Strategy[], repeats: number,
  adapterFor: (strategy: Strategy, script: string | undefined) => Adapter,
  useScripts: boolean, signal?: AbortSignal): Promise<{ path: string; report: SuiteReport }> {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Repeats must be an integer from 1 to 10');
  if (!conditions.length || new Set(conditions).size !== conditions.length || conditions.some((c) => !strategies.includes(c)))
    throw new Error('Choose unique supported strategies');
  const base = dirname(resolve(file));
  const suite = suiteSchema.parse(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  // Parse every task and configure every adapter before executing any case.
  const cases = suite.cases.map((entry) => {
    const taskFile = resolve(base, entry.task);
    const parsed = taskSchema.parse(JSON.parse(readFileSync(taskFile, 'utf8')) as unknown);
    const task = { ...parsed, repository: resolve(dirname(taskFile), parsed.repository) };
    const adapters = new Map(conditions.map((strategy) => {
      const script = entry.scripts?.[strategy];
      if (useScripts && !script) throw new Error(`Missing script for ${entry.id}/${strategy}`);
      return [strategy, adapterFor(strategy, useScripts ? resolve(base, script!) : undefined)] as const;
    }));
    return { id: entry.id, task, adapters };
  });
  const id = randomUUID();
  const directory = join(store.root, 'suites', id); mkdirSync(directory, { recursive: true });
  const path = join(directory, 'report.json');
  const report: SuiteReport = { version: 1, id, name: suite.name, startedAt: new Date().toISOString(),
    status: 'running', error: null, conditions, repeats, results: [],
    notes: ['Task budgets apply independently to each condition and repeat; this is not a shared agent-run budget.',
      'Included development fixtures are not held-out research evidence. Scripted results measure runtime control flow only.',
      'Visible acceptance checks can miss defects. No statistical significance or general superiority is claimed.'] };
  const save = () => { writeFileSync(path + '.tmp', JSON.stringify(report, null, 2) + '\n'); renameSync(path + '.tmp', path); };
  save();
  try {
    for (const entry of cases) {
      signal?.throwIfAborted();
      const result = await compare(store, entry.task, conditions, repeats, (strategy) => entry.adapters.get(strategy)!, signal);
      report.results.push({ caseId: entry.id, ...result }); save();
      if (result.report.status !== 'completed') throw new Error(result.report.error ?? `Case ${entry.id} interrupted`);
    }
    report.status = 'completed';
  } catch (error) {
    report.status = 'interrupted'; report.error = error instanceof Error ? error.message : 'Interrupted';
  }
  save(); return { path, report };
}
