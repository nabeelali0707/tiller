import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { relativeFile, taskSchema } from '../core/contracts.js';
import type { Adapter } from '../core/contracts.js';
import { Store } from '../storage/store.js';
import { compare, supportedStrategies } from './compare.js';
import type { ComparisonReport, Strategy } from './compare.js';
import { evaluateOracle } from './oracle.js';
import type { OracleSpec } from './oracle.js';
import { hash, safeFile } from '../tools/workspace.js';

export const suiteSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(200),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80),
    task: z.string().min(1),
    partition: z.enum(['development', 'held-out']).default('development'),
    oracle: z.object({ repository: z.string().min(1), files: z.array(relativeFile).min(1).max(20),
      checks: taskSchema.shape.checks }).strict().optional(),
    scripts: z.partialRecord(z.enum(supportedStrategies as [Strategy, ...Strategy[]]), z.string().min(1)).optional(),
  }).strict()).min(1).max(20),
}).strict().refine((suite) => new Set(suite.cases.map((c) => c.id.toLowerCase())).size === suite.cases.length,
  'Case IDs must be unique (case-insensitive)');

export interface SuiteReport {
  version: 1; id: string; name: string; startedAt: string;
  status: 'running' | 'completed' | 'interrupted'; error: string | null;
  conditions: Strategy[]; repeats: number;
  results: { caseId: string; partition: 'development' | 'held-out'; path: string; report: ComparisonReport;
    evaluations?: Awaited<ReturnType<typeof evaluateOracle>>[] }[];
  notes: string[];
}

export async function evaluateSuite(store: Store, file: string, conditions: Strategy[], repeats: number,
  adapterFor: (strategy: Strategy, script: string | undefined) => Adapter,
  useScripts: boolean, signal?: AbortSignal): Promise<{ path: string; report: SuiteReport }> {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Repeats must be an integer from 1 to 10');
  if (!conditions.length || new Set(conditions).size !== conditions.length || conditions.some((c) => !supportedStrategies.includes(c)))
    throw new Error('Choose unique supported strategies');
  const base = dirname(resolve(file));
  const suite = suiteSchema.parse(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  // Parse every task and configure every adapter before executing any case.
  const cases = suite.cases.map((entry) => {
    const taskFile = resolve(base, entry.task);
    const parsed = taskSchema.parse(JSON.parse(readFileSync(taskFile, 'utf8')) as unknown);
    const task = { ...parsed, repository: resolve(dirname(taskFile), parsed.repository) };
    if (conditions.includes('search') && task.execution?.mode !== 'docker') throw new Error(`Search requires Docker execution for case ${entry.id}`);
    const adapters = new Map(conditions.map((strategy) => {
      const script = entry.scripts?.[strategy];
      if (useScripts && !script) throw new Error(`Missing script for ${entry.id}/${strategy}`);
      return [strategy, adapterFor(strategy, useScripts ? resolve(base, script!) : undefined)] as const;
    }));
    const oracle: OracleSpec | undefined = entry.oracle ? { ...entry.oracle, repository: resolve(base, entry.oracle.repository) } : undefined;
    if (oracle && oracle.files.some((file) => task.files.some((existing) => existing.toLowerCase() === file.toLowerCase()))) throw new Error(`Oracle overlaps agent inputs for ${entry.id}`);
    if (oracle) oracle.inputHashes = Object.fromEntries(oracle.files.map((file) => [file, hash(readFileSync(safeFile(oracle.repository, file)))]));
    return { id: entry.id, partition: entry.partition, task, adapters, oracle };
  });
  const partitions = new Map<string, string>();
  for (const entry of cases) {
    const repository = realpathSync(entry.task.repository);
    if (partitions.has(repository) && partitions.get(repository) !== entry.partition) throw new Error('A repository cannot appear in both development and held-out partitions');
    partitions.set(repository, entry.partition);
  }
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
      const row: SuiteReport['results'][number] = { caseId: entry.id, partition: entry.partition, ...result };
      report.results.push(row); save();
      if (result.report.status !== 'completed') throw new Error(result.report.error ?? `Case ${entry.id} interrupted`);
      if (entry.oracle) {
        row.evaluations = [];
        for (const run of result.report.rows) {
          signal?.throwIfAborted();
          const evaluation = await evaluateOracle(store, store.load(run.runId), entry.oracle,
            join(directory, 'evaluations'), signal ?? new AbortController().signal);
          row.evaluations.push(evaluation); save();
        }
      }
    }
    report.status = 'completed';
  } catch (error) {
    report.status = 'interrupted'; report.error = error instanceof Error ? error.message : 'Interrupted';
  }
  save(); return { path, report };
}
