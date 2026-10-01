import { mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Run } from '../core/contracts.js';
import { taskSchema } from '../core/contracts.js';
import type { Task } from '../core/contracts.js';
import { Store } from '../storage/store.js';
import { assertCheckpoint, assertProtected, hash, hashes, safeFile } from '../tools/workspace.js';
import { runCheck } from '../tools/checks.js';
import { sandboxServices } from '../tools/sandbox.js';
import type { SandboxServices } from '../tools/sandbox.js';

export interface OracleSpec { repository: string; files: string[]; checks: Task['checks']; inputHashes?: Record<string, string> }
export async function evaluateOracle(store: Store, run: Run, spec: OracleSpec, directory: string,
  signal: AbortSignal, sandbox: SandboxServices = sandboxServices) {
  if (spec.files.some((file) => run.task.files.some((existing) => existing.toLowerCase() === file.toLowerCase())))
    throw new Error('Evaluation files must not overlap agent-visible inputs');
  const task = taskSchema.parse({ version: 1, goal: 'Independent evaluation', repository: spec.repository,
    files: [...run.task.files, ...spec.files], editable: run.task.editable, checks: spec.checks,
    ...(run.task.execution ? { execution: run.task.execution } : {}) });
  const source = join(store.directory(run.id), 'workspace');
  assertCheckpoint(run, source); assertProtected(run, store.directory(run.id));
  const workspace = join(directory, run.id); mkdirSync(workspace, { recursive: true });
  for (const file of task.files) {
    const origin = safeFile(spec.files.includes(file) ? spec.repository : source, file);
    if (spec.inputHashes?.[file] && hash(readFileSync(origin)) !== spec.inputHashes[file]) throw new Error('Evaluation inputs changed since preflight');
    const target = join(workspace, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(origin, target);
  }
  const before = hashes(task, workspace); const results = [];
  const started = Date.now();
  const image = task.execution?.mode === 'docker' ? await sandbox.prepare(run.dockerImage ?? task.execution.image) : null;
  for (const check of task.checks) {
    signal.throwIfAborted();
    results.push(image ? await sandbox.check(check, workspace, image, signal, check.timeoutMs)
      : await runCheck(check, workspace, signal, check.timeoutMs));
    if (JSON.stringify(hashes(task, workspace)) !== JSON.stringify(before)) throw new Error('Evaluation check changed declared inputs');
  }
  // These checks are post-run evaluation cost, not model-visible run acceptance or feedback.
  return { runId: run.id, passed: results.every((result) => result.passed), results, hashes: before,
    elapsedMs: Date.now() - started, evaluationToolCalls: results.length, image };
}
