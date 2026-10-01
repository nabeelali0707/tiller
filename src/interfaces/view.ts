import type { Run } from '../core/contracts.js';
import { Store } from '../storage/store.js';
import { masked } from '../security/redaction.js';
export function runView(store: Store, run: Run) {
  return masked({ id: run.id, goal: run.task.goal, status: run.status, message: run.message,
    strategy: run.task.strategy ?? 'sequential', executionMode: run.task.execution?.mode ?? 'trusted-local', adapter: run.adapter,
    createdAt: run.createdAt, deadline: run.deadline, budget: run.task.budget,
    spent: { modelCalls: run.calls, toolCalls: run.tools, inputTokens: run.inputTokens, outputTokens: run.outputTokens, unknownUsageCalls: run.unknownUsageCalls },
    cancellationRequested: store.cancelled(run.id), pending: run.pending ? { kind: run.pending.kind, id: run.pending.id } : null,
    queuedAction: run.queuedAction ? { type: run.queuedAction.type } : null,
    remainingPlan: run.remainingPlan, hierarchy: run.hierarchy ?? null, segments: run.segments ?? [], searchState: run.searchState ?? null,
    acceptance: run.status === 'succeeded' ? 'Declared checks passed' : 'No verified completion',
  });
}
export function timeline(store: Store, id: string) {
  return store.events(id).map((event) => {
    const data = event.data as Record<string, unknown>;
    // Do not include whole-file read/write content in default timeline responses.
    const details = event.type === 'operation.completed' ? (() => {
      const result = data.result as Record<string, unknown> | undefined;
      return result ? { path: result.path, checkId: result.checkId, passed: result.passed, exitCode: result.exitCode,
        output: typeof result.output === 'string' ? result.output.slice(0, 4000) : undefined, error: result.error } : {};
    })() : { message: data.message, nodeId: data.nodeId, childId: data.childId, status: data.status,
      reason: data.reason, segment: data.segment, winner: data.winner };
    return masked({ seq: event.seq, at: event.at, type: event.type, details });
  });
}
