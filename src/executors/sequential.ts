import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { BudgetError, decisionSchema, reserve, taskSchema, transition } from '../core/contracts.js';
import type { Action, Adapter, Run, Task } from '../core/contracts.js';
import { Store } from '../storage/store.js';
import { assertCheckpoint, assertProtected, changes, hashes, patchText, readAllowed, snapshot, writeAllowed } from '../tools/workspace.js';
import { runCheck } from '../tools/checks.js';
import type { CheckResult } from '../tools/checks.js';

export function createRun(store: Store, task: Task, adapter: Adapter): Run {
  task = taskSchema.parse(task);
  const id = randomUUID();
  const run: Run = {
    version: 1, id, task, adapter: adapter.id, status: 'ready', createdAt: Date.now(), deadline: null,
    calls: 0, tools: 0, inputTokens: 0, outputTokens: 0, unknownUsageCalls: 0,
    decisionIndex: 0, planVersion: 0, remainingPlan: [], pending: null,
    hashes: snapshot(task, store.directory(id)), baselineDone: false, observations: [], message: '',
  };
  store.save(run, 'run.created', { executionMode: 'trusted-local', strategy: 'sequential', adapter: adapter.id, snapshot: run.hashes });
  return run;
}

function observe(run: Run, type: string, result: unknown): void {
  run.observations.push({ type, result });
  // Full history remains in SQLite; provider context is bounded independently.
  run.observations = run.observations.slice(-8);
}

export function reconcileRun(store: Store, id: string): Run {
  const release = store.lock(id);
  try {
    const run = store.load(id);
    if (!['running', 'verifying', 'paused'].includes(run.status)) throw new Error('Only interrupted or paused runs can be reconciled');
    const directory = store.directory(id);
    assertProtected(run, directory);
    const pending = run.pending;
    run.hashes = hashes(run.task, join(directory, 'workspace'));
    run.pending = null;
    transition(run, 'paused', 'Operator accepted current workspace; all acceptance checks will be rerun');
    observe(run, 'reconciled', { pending, hashes: run.hashes });
    store.save(run, 'run.reconciled', { pending, hashes: run.hashes, provenance: 'operator-confirmed' });
    return run;
  } finally { release(); }
}

export async function execute(store: Store, id: string, adapter: Adapter, externalSignal?: AbortSignal): Promise<Run> {
  const release = store.lock(id);
  let timer: NodeJS.Timeout | undefined;
  let deadlineTimer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort('pause');
  try {
    const run = store.load(id);
    if (!['ready', 'paused', 'running', 'verifying'].includes(run.status)) throw new Error(`Cannot resume ${run.status} run`);
    if (run.adapter !== adapter.id) throw new Error('Resume requires the same adapter/model or exact script');
    if (store.cancelled(id)) {
      transition(run, 'cancelled', 'Cancellation requested; any unresolved operation remains recorded');
      store.save(run, 'run.cancelled', { pending: run.pending }); return run;
    }
    if (run.pending) {
      transition(run, 'paused', 'Unresolved operation; inspect and reconcile before resume');
      store.save(run, 'run.reconciliation_required', run.pending);
      return run;
    }
    const directory = store.directory(id);
    const workspace = join(directory, 'workspace');
    try { assertCheckpoint(run, workspace); assertProtected(run, directory); }
    catch (error) {
      if (run.status === 'ready') transition(run, 'running');
      transition(run, 'paused', (error as Error).message);
      store.save(run, 'run.workspace_conflict'); return run;
    }
    // The deadline is fixed on first execution and includes downtime between resumes.
    run.deadline ??= Date.now() + run.task.budget.maxDurationMs;
    transition(run, 'running');
    store.save(run, 'run.started', { deadline: run.deadline, hashes: run.hashes });
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    timer = setInterval(() => { if (store.cancelled(id)) controller.abort('cancel'); }, 100);
    deadlineTimer = setTimeout(() => controller.abort('deadline'), Math.max(1, run.deadline - Date.now()));

    const ensureActive = () => {
      if (store.cancelled(id)) controller.abort('cancel');
      if (Date.now() >= run.deadline!) controller.abort('deadline');
      controller.signal.throwIfAborted();
    };
    const persistResult = (kind: string, result: unknown) => {
      assertProtected(run, directory);
      run.hashes = hashes(run.task, workspace);
      const pending = run.pending;
      run.pending = null;
      observe(run, kind, result);
      store.save(run, 'operation.completed', { operation: pending, result, hashes: run.hashes, provenance: 'runtime-observed' });
    };
    const check = async (definition: Task['checks'][number], final: boolean): Promise<CheckResult> => {
      ensureActive(); assertCheckpoint(run, workspace); assertProtected(run, directory);
      reserve(run, 'tool', 1, final);
      run.pending = { id: randomUUID(), kind: 'check', detail: { checkId: definition.id, final } };
      store.save(run, 'operation.started', run.pending);
      const result = await runCheck(definition, workspace, controller.signal, run.deadline! - Date.now());
      // Acceptance commands may execute code, but changing declared files invalidates the checkpoint.
      assertCheckpoint(run, workspace);
      persistResult('check', result);
      ensureActive();
      return result;
    };
    const tool = async (action: Exclude<Action, { type: 'complete' }>) => {
      if (action.type === 'check') {
        const definition = run.task.checks.find((c) => c.id === action.checkId);
        if (!definition) throw new Error(`Unknown check: ${action.checkId}`);
        return check(definition, false);
      }
      ensureActive(); assertCheckpoint(run, workspace); assertProtected(run, directory);
      reserve(run, 'tool');
      run.pending = { id: randomUUID(), kind: action.type, detail: action };
      store.save(run, 'operation.started', run.pending);
      let result: unknown;
      try {
        if (action.type === 'read') result = { path: action.path, content: readAllowed(run, workspace, action.path) };
        else { writeAllowed(run, workspace, action.path, action.content); result = { path: action.path, written: true }; }
      } catch (error) {
        // A failed write can be partial. Leave it pending rather than declaring a known outcome.
        if (action.type === 'write') throw error;
        result = { error: (error as Error).message };
      }
      persistResult(action.type, result);
    };

    try {
      ensureActive();
      if (!run.baselineDone) {
        for (const definition of run.task.checks) await check(definition, false);
        run.baselineDone = true;
        store.save(run, 'baseline.completed');
      }
      while (true) {
        ensureActive(); assertCheckpoint(run, workspace); assertProtected(run, directory);
        reserve(run, 'model');
        run.pending = { id: randomUUID(), kind: 'model', detail: { adapter: adapter.id } };
        store.save(run, 'model.started', run.pending);
        const reply = await adapter.next(structuredClone(run), controller.signal);
        if (reply.usage && Number.isSafeInteger(reply.usage.inputTokens) && reply.usage.inputTokens >= 0 &&
          Number.isSafeInteger(reply.usage.outputTokens) && reply.usage.outputTokens >= 0) {
          run.inputTokens += reply.usage.inputTokens;
          run.outputTokens += reply.usage.outputTokens;
          run.unknownUsageCalls--;
        }
        run.pending = null;
        store.save(run, 'model.completed', { usage: reply.usage ?? null });
        ensureActive();
        const parsed = decisionSchema.safeParse(reply.decision);
        if (!parsed.success) {
          observe(run, 'invalid_decision', { error: 'Decision failed schema validation. Return exactly the documented JSON shape.' });
          store.save(run, 'decision.rejected', { issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
          continue;
        }
        const decision = parsed.data;
        run.decisionIndex++;
        run.planVersion++;
        run.remainingPlan = decision.remainingPlan;
        store.save(run, 'plan.revised', { version: run.planVersion, ...decision, provenance: 'model-proposed' });
        if (decision.action.type !== 'complete') {
          await tool(decision.action);
          continue;
        }
        transition(run, 'verifying');
        store.save(run, 'verification.started', { completionProposal: decision.action.summary });
        const results: CheckResult[] = [];
        for (const definition of run.task.checks) results.push(await check(definition, true));
        ensureActive();
        if (results.every((result) => result.passed)) {
          assertCheckpoint(run, workspace); assertProtected(run, directory);
          const patch = changes(run, directory);
          writeFileSync(join(directory, 'changes.json'), JSON.stringify(patch, null, 2) + '\n');
          writeFileSync(join(directory, 'changes.patch'), patchText(run, directory));
          transition(run, 'succeeded', 'All declared acceptance checks passed on the recorded workspace');
          store.save(run, 'run.succeeded', { results, hashes: run.hashes, artifact: 'changes.json' });
          break;
        }
        transition(run, 'running', 'Completion rejected: acceptance checks failed');
        observe(run, 'completion_rejected', { results });
        store.save(run, 'verification.failed', { results });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        transition(run, reason === 'cancel' ? 'cancelled' : reason === 'deadline' ? 'budget_exhausted' : 'paused',
          reason === 'pause' ? 'Paused; inspect pending operation before resuming' : `Stopped: ${String(reason)}`);
      } else if (error instanceof BudgetError) transition(run, 'budget_exhausted', error.message);
      else transition(run, 'paused', error instanceof Error ? error.message : 'Execution interrupted');
      store.save(run, `run.${run.status}`, { message: run.message, pending: run.pending });
    }
    return run;
  } finally {
    if (timer) clearInterval(timer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    externalSignal?.removeEventListener('abort', abort);
    release();
  }
}
