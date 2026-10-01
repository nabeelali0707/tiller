import { dirname, join } from 'node:path';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BudgetError, reserve, transition } from '../core/contracts.js';
import type { Adapter, Run } from '../core/contracts.js';
import { Store } from '../storage/store.js';
import { createRun, execute } from './runtime.js';
import { assertCheckpoint, assertProtected, changes, hashes, patchText, safeFile } from '../tools/workspace.js';
import { sandboxServices } from '../tools/sandbox.js';
import type { SandboxServices } from '../tools/sandbox.js';

export async function executeSearch(store: Store, id: string, adapter: Adapter, signal?: AbortSignal, sandbox: SandboxServices = sandboxServices): Promise<Run> {
  const release = store.lock(id);
  const run = store.load(id);
  const root = store.directory(id); const workspace = join(root, 'workspace');
  const controller = new AbortController(); const abort = () => controller.abort('pause');
  let timer: NodeJS.Timeout | undefined; let deadlineTimer: NodeJS.Timeout | undefined;
  try {
    if (!['ready', 'running', 'paused', 'verifying'].includes(run.status)) throw new Error(`Cannot resume ${run.status} run`);
    if (adapter.id !== run.adapter) throw new Error('Resume requires the same adapter/model or exact script');
    if (run.task.execution?.mode !== 'docker') throw new Error('Search requires Docker sandbox execution');
    run.deadline ??= Date.now() + run.task.budget.maxDurationMs;
    transition(run, 'running'); store.save(run, 'search.started');
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    timer = setInterval(() => { if (store.cancelled(id)) controller.abort('cancel'); }, 100);
    deadlineTimer = setTimeout(() => controller.abort('deadline'), Math.max(1, run.deadline - Date.now()));
    const active = () => {
      if (store.cancelled(id)) controller.abort('cancel');
      if (Date.now() >= run.deadline!) controller.abort('deadline');
      controller.signal.throwIfAborted();
    };
    try {
      active(); assertCheckpoint(run, workspace); assertProtected(run, root);
      run.dockerImage = await sandbox.prepare(run.dockerImage ?? run.task.execution.image);
      if (!run.searchState) {
        for (const file of run.task.files) {
          const destination = join(root, 'search-entry', file); mkdirSync(dirname(destination), { recursive: true });
          copyFileSync(safeFile(workspace, file), destination);
        }
        run.searchState = { entryHashes: { ...run.hashes }, candidates: [], phase: 'candidates' };
      }
      store.save(run, 'search.prepared', { image: run.dockerImage, entryHashes: run.searchState.entryHashes });
      if (run.pending && run.pending.kind !== 'candidate') throw new Error('Unresolved Search operation; inspect and reconcile before resume');
      const count = run.task.search?.candidates ?? 2;
      while (run.searchState.phase === 'candidates') {
        active();
        const unfinished = run.searchState.candidates.find((candidate) => ['ready', 'running', 'verifying', 'paused'].includes(store.load(candidate).status));
        if (!unfinished && run.searchState.candidates.length >= count) break;
        let child: Run;
        if (unfinished) child = store.load(unfinished);
        else {
          const remaining = count - run.searchState.candidates.length;
          const maxModelCalls = Math.floor((run.task.budget.maxModelCalls - run.calls) / remaining);
          const maxToolCalls = Math.floor((run.task.budget.maxToolCalls - run.tools - run.task.checks.length - 1) / remaining);
          if (maxModelCalls < 1 || maxToolCalls < run.task.checks.length * 2)
            throw new BudgetError('Search cannot afford remaining candidates and promotion verification');
          child = createRun(store, { ...run.task, strategy: 'sequential', routing: undefined, repository: join(root, 'search-entry'),
            goal: `${run.task.goal}\nSearch candidate ${run.searchState.candidates.length + 1}/${count}: develop an independent repair. Prior attempts: ${JSON.stringify(run.searchState.candidates.map((childId) => ({ outcome: store.load(childId).status, message: store.load(childId).message })))}`,
            budget: { ...run.task.budget, maxModelCalls, maxToolCalls } }, adapter);
          child.deadline = run.deadline;
          store.save(child, 'candidate.created', { parent: run.id });
          if (JSON.stringify(child.hashes) !== JSON.stringify(run.searchState.entryHashes)) throw new Error('Candidate input differs from Search snapshot');
          run.searchState.candidates.push(child.id);
        }
        run.pending = { id: randomUUID(), kind: 'candidate', detail: { childId: child.id } };
        store.save(run, 'search.candidate_started', run.pending);
        const result = await execute(store, child.id, adapter, controller.signal, {
          reserve: (kind) => { active(); reserve(run, kind); store.save(run, 'search.resource_reserved', { childId: child.id, kind }); },
          usage: (inputTokens, outputTokens) => {
            run.inputTokens += inputTokens; run.outputTokens += outputTokens; run.unknownUsageCalls--;
            store.save(run, 'search.usage_recorded', { childId: child.id, inputTokens, outputTokens });
          },
        }, sandbox);
        if (result.status === 'paused') throw new Error(`Candidate ${child.id} paused: inspect and reconcile its pending operation before resuming Search`);
        run.pending = null;
        store.save(run, 'search.candidate_completed', { childId: child.id, status: result.status });
        active();
      }
      if (run.searchState.phase === 'candidates') {
        const eligible = run.searchState.candidates.map((childId) => store.load(childId)).filter((child) => child.status === 'succeeded');
        eligible.sort((a, b) => changes(a, store.directory(a.id)).length - changes(b, store.directory(b.id)).length || a.calls - b.calls || a.id.localeCompare(b.id));
        const winner = eligible[0];
        if (!winner) { transition(run, 'failed', 'No Search candidate passed acceptance checks'); store.save(run, 'search.no_winner'); return run; }
        run.searchState.winner = winner.id; run.searchState.phase = 'promotion';
        store.save(run, 'search.winner_selected', { winner: winner.id, selection: 'fewest-changed-files-then-calls-then-id' });
      }
      if (run.searchState.phase === 'promotion') {
        active(); assertCheckpoint(run, workspace); assertProtected(run, root);
        if (JSON.stringify(run.hashes) !== JSON.stringify(run.searchState.entryHashes))
          throw new Error('Search destination differs from entry snapshot; restore it or start a new run');
        const winner = store.load(run.searchState.winner!); const winnerRoot = store.directory(winner.id);
        assertCheckpoint(winner, join(winnerRoot, 'workspace')); assertProtected(winner, winnerRoot);
        reserve(run, 'tool');
        run.pending = { id: randomUUID(), kind: 'promotion', detail: { winner: winner.id } };
        store.save(run, 'search.promotion_started', run.pending);
        for (const file of run.task.editable) writeFileSync(safeFile(workspace, file), readFileSync(safeFile(join(winnerRoot, 'workspace'), file)));
        run.hashes = hashes(run.task, workspace); run.pending = null; run.searchState.phase = 'verification';
        store.save(run, 'search.promoted', { hashes: run.hashes });
      }
      transition(run, 'verifying'); store.save(run, 'verification.started', { source: 'search-promotion' });
      const results = [];
      for (const definition of run.task.checks) {
        active(); assertCheckpoint(run, workspace); assertProtected(run, root); reserve(run, 'tool', 1, true);
        run.pending = { id: randomUUID(), kind: 'check', detail: { checkId: definition.id, final: true } };
        store.save(run, 'operation.started', run.pending);
        const result = await sandbox.check(definition, workspace, run.dockerImage!, controller.signal, run.deadline! - Date.now(), run.pending.id);
        assertCheckpoint(run, workspace); assertProtected(run, root);
        run.pending = null; results.push(result); store.save(run, 'operation.completed', { result, provenance: 'runtime-observed' });
      }
      active();
      if (results.every((result) => result.passed)) {
        writeFileSync(join(root, 'changes.json'), JSON.stringify(changes(run, root), null, 2) + '\n');
        writeFileSync(join(root, 'changes.patch'), patchText(run, root));
        transition(run, 'succeeded', 'Search winner passed checks again after promotion');
      } else transition(run, 'failed', 'Search promotion failed final verification');
      store.save(run, `run.${run.status}`, { results, hashes: run.hashes });
    } catch (error) {
      const reason = controller.signal.reason;
      transition(run, controller.signal.aborted ? reason === 'cancel' ? 'cancelled' : reason === 'deadline' ? 'budget_exhausted' : 'paused'
        : error instanceof BudgetError ? 'budget_exhausted' : 'paused', error instanceof Error ? error.message : String(error));
      store.save(run, `run.${run.status}`, { pending: run.pending, message: run.message });
    }
    return run;
  } finally {
    if (timer) clearInterval(timer); if (deadlineTimer) clearTimeout(deadlineTimer);
    signal?.removeEventListener('abort', abort); release();
  }
}
