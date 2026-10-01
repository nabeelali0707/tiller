import type { Run, Task } from './contracts.js';
import { hash } from '../tools/workspace.js';

export function monitorResult(run: Run, kind: string, result: unknown): void {
  if (!run.task.routing?.enabled) return;
  const monitor = run.monitor ??= { failures: 0, operations: 0, lastSwitchOperation: -100, lastFailure: null };
  monitor.operations++;
  if (kind !== 'check') return;
  const check = result as { passed: boolean; checkId: string; output: string };
  if (check.passed) { monitor.failures = 0; monitor.lastFailure = null; return; }
  const signature = hash(JSON.stringify({ checkId: check.checkId, output: check.output }));
  monitor.failures = signature === monitor.lastFailure ? monitor.failures + 1 : 1;
  monitor.lastFailure = signature;
}

export function switchTarget(run: Run): Task['strategy'] | null {
  const policy = run.task.routing; const monitor = run.monitor;
  if (!policy?.enabled || !monitor || monitor.failures < policy.failureThreshold || run.pending) return null;
  const switches = Math.max(0, (run.segments?.length ?? 1) - 1);
  if (switches >= policy.maxSwitches || monitor.operations - monitor.lastSwitchOperation < policy.cooldownOperations) return null;
  if (run.task.strategy === 'hierarchical') return 'sequential';
  if (run.task.strategy === 'sequential' && run.task.execution?.mode === 'docker' &&
    run.task.budget.maxModelCalls - run.calls >= 2 && run.task.budget.maxToolCalls - run.tools >= 5 * run.task.checks.length) return 'search';
  return null;
}

export function applySwitch(run: Run, target: Task['strategy']): void {
  if (switchTarget(run) !== target) throw new Error('Strategy handoff is unsupported, unaffordable, or outside policy limits');
  run.segments ??= [{ generation: 0, strategy: run.task.strategy, reason: 'Initial strategy', calls: 0, tools: 0, hashes: { ...run.hashes } }];
  const previous = run.segments.at(-1)!;
  if (run.hierarchy) previous.hierarchy = structuredClone(run.hierarchy);
  run.segments.push({ generation: previous.generation + 1, strategy: target, reason: 'Repeated identical failing check results',
    calls: run.calls, tools: run.tools, hashes: { ...run.hashes } });
  run.task.strategy = target; delete run.hierarchy; delete run.declaredPlan;
  run.remainingPlan = []; run.planVersion++;
  run.monitor!.lastSwitchOperation = run.monitor!.operations; run.monitor!.failures = 0;
  run.monitor!.lastFailure = null;
  run.observations.push({ type: 'strategy_switched', result: { target, reason: run.segments.at(-1)!.reason } });
  run.observations = run.observations.slice(-8);
}
