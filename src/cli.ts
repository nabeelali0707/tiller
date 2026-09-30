#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { taskSchema } from './core/contracts.js';
import type { Adapter, Run } from './core/contracts.js';
import { Store } from './storage/store.js';
import { ScriptedAdapter } from './adapters/scripted.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { OllamaAdapter } from './adapters/ollama.js';
import { createRun, execute, reconcileRun } from './executors/runtime.js';
import { patchText } from './tools/workspace.js';

const help = `Tiller - local agent execution runtime (Node 24.14+)

  run <task.json> [--script <decisions.json> | --model <model-id>]
  resume <run-id> [--script <same-decisions.json> | --model <same-model-id>]
  inspect <run-id>          Show checkpoint, counters and latest observations
  trace <run-id>            Print ordered events as NDJSON; never executes tools
  diff <run-id>             Show the workspace patch against the input snapshot
  cancel <run-id>           Request cancellation (an active worker observes it)
  reconcile <run-id> --accept-workspace
                           Record operator reconciliation of interrupted work
  unlock <run-id> --confirm-owner-stopped
                           Remove a stale lock only when its PID is no longer alive
  validate <task.json>      Validate a task manifest without executing commands

Options: --data-dir <path> (default .tiller in current directory), --help
Local models: --provider ollama --model <installed-model> [--ollama-url http://127.0.0.1:11434]
OpenAI: --provider openai with OPENAI_API_KEY and --model or TILLER_MODEL.
Checks execute local code. Use only trusted repositories/check commands.
Workspace copies are not security sandboxes. Source files are not auto-updated.
`;

function adapterFor(script?: string, model?: string, provider?: string, ollamaUrl?: string): Adapter {
  if (script && (model || provider || ollamaUrl)) throw new Error('Use either --script or provider/model options');
  if (script) return ScriptedAdapter.fromFile(resolve(script));
  const selected = provider ?? process.env.TILLER_PROVIDER ?? 'openai';
  if (selected === 'ollama') return new OllamaAdapter(model ?? process.env.TILLER_MODEL ?? '', ollamaUrl);
  if (selected !== 'openai') throw new Error('Provider must be ollama or openai');
  if (ollamaUrl) throw new Error('--ollama-url requires --provider ollama');
  return new OpenAIAdapter(model ?? process.env.TILLER_MODEL ?? '', process.env.OPENAI_API_KEY ?? '');
}

function report(store: Store, run: Run) {
  return { id: run.id, status: run.status, message: run.message, adapter: run.adapter,
    workspace: join(store.directory(run.id), 'workspace'), executionMode: 'trusted-local',
    cancellationRequested: store.cancelled(run.id),
    deadline: run.deadline === null ? null : new Date(run.deadline).toISOString(),
    budget: run.task.budget, spent: { modelCalls: run.calls, toolCalls: run.tools,
      inputTokens: run.inputTokens, outputTokens: run.outputTokens, unknownUsageCalls: run.unknownUsageCalls },
    planVersion: run.planVersion, remainingPlan: run.remainingPlan, pending: run.pending,
    observations: run.observations, hashes: run.hashes, strategy: run.task.strategy ?? 'sequential', hierarchy: run.hierarchy ?? null,
    artifacts: run.status === 'succeeded' ? ['changes.patch', 'changes.json'].map((p) => join(store.directory(run.id), p)) : [],
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    help: { type: 'boolean' }, script: { type: 'string' }, model: { type: 'string' },
    provider: { type: 'string' }, 'ollama-url': { type: 'string' },
    'data-dir': { type: 'string' }, 'accept-workspace': { type: 'boolean' }, 'confirm-owner-stopped': { type: 'boolean' },
  } });
  if (values.help || positionals.length === 0) { console.log(help); return; }
  const [command, target] = positionals;
  if (positionals.length !== 2 || !target) throw new Error('Expected a command and task file/run ID; see --help');
  if (!['run', 'resume', 'inspect', 'trace', 'diff', 'cancel', 'reconcile', 'unlock', 'validate'].includes(command!))
    throw new Error(`Unknown command: ${command}`);
  if ((values.script || values.model || values.provider || values['ollama-url']) && !['run', 'resume'].includes(command!)) throw new Error('Adapter options only apply to run/resume');
  if (values['accept-workspace'] && command !== 'reconcile') throw new Error('--accept-workspace is only valid for reconcile');
  if (values['confirm-owner-stopped'] && command !== 'unlock') throw new Error('--confirm-owner-stopped is only valid for unlock');
  const loadTask = () => {
    const file = resolve(target);
    const task = taskSchema.parse(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    return { ...task, repository: resolve(dirname(file), task.repository) };
  };
  if (command === 'validate') { console.log(JSON.stringify(loadTask(), null, 2)); return; }
  const store = new Store(values['data-dir'] ?? '.tiller');
  try {
    if (command === 'run' || command === 'resume') {
      const adapter = adapterFor(values.script, values.model, values.provider, values['ollama-url']);
      const run = command === 'run' ? createRun(store, loadTask(), adapter) : store.load(target);
      console.error(`Run ${run.id}\nWorkspace: ${join(store.directory(run.id), 'workspace')}`);
      const controller = new AbortController();
      const pause = () => controller.abort();
      process.on('SIGINT', pause); process.on('SIGTERM', pause);
      try {
        const result = await execute(store, run.id, adapter, controller.signal);
        console.log(JSON.stringify(report(store, result), null, 2));
        process.exitCode = result.status === 'succeeded' ? 0 : 2;
      } finally { process.off('SIGINT', pause); process.off('SIGTERM', pause); }
    } else if (command === 'inspect') console.log(JSON.stringify(report(store, store.load(target)), null, 2));
    else if (command === 'trace') for (const event of store.events(target)) console.log(JSON.stringify(event));
    else if (command === 'diff') process.stdout.write(patchText(store.load(target), store.directory(target)));
    else if (command === 'cancel') { store.cancel(target); console.log(`Cancellation requested for ${target}`); }
    else if (command === 'unlock') {
      if (!values['confirm-owner-stopped']) throw new Error('Inspect the owner and use --confirm-owner-stopped');
      store.unlock(target); console.log('Stale lock removed. Inspect pending operations before resuming.');
    } else if (command === 'reconcile') {
      if (!values['accept-workspace']) throw new Error('Inspect pending operations and side effects, then use --accept-workspace');
      console.log(JSON.stringify(report(store, reconcileRun(store, target)), null, 2));
    }
  } finally { store.close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unexpected error'); process.exitCode = 1;
});
