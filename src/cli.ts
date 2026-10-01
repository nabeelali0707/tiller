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
import { compare, strategies } from './eval/compare.js';
import type { Strategy } from './eval/compare.js';
import { evaluateSuite } from './eval/suite.js';
import { doctor } from './tools/doctor.js';

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
  compare <task.json>       Compare strategies with identical inputs/tools/budget caps
                           --strategies flat-react,plan-react,sequential,hierarchical --repeats 1
                           Use provider/model options or --scripts <strategy-to-script JSON>
  evaluate <suite.json>     Run comparisons across a task suite; use --scripted for fixtures
                           Accepts --strategies, --repeats and provider/model options
  doctor                   Check Node, selected local model and Docker sandbox prerequisites
  dashboard                Open a loopback dashboard; --port defaults to a free port
  mcp                      Serve MCP over stdio; --workspace scopes Docker tasks

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
    workspace: join(store.directory(run.id), 'workspace'), executionMode: run.task.execution?.mode ?? 'trusted-local',
    dockerImage: run.dockerImage ?? null,
    cancellationRequested: store.cancelled(run.id),
    deadline: run.deadline === null ? null : new Date(run.deadline).toISOString(),
    budget: run.task.budget, spent: { modelCalls: run.calls, toolCalls: run.tools,
      inputTokens: run.inputTokens, outputTokens: run.outputTokens, unknownUsageCalls: run.unknownUsageCalls },
    planVersion: run.planVersion, remainingPlan: run.remainingPlan, pending: run.pending,
    observations: run.observations, hashes: run.hashes, strategy: run.task.strategy ?? 'sequential', hierarchy: run.hierarchy ?? null,
    declaredPlan: run.declaredPlan ?? null,
    artifacts: run.status === 'succeeded' ? ['changes.patch', 'changes.json'].map((p) => join(store.directory(run.id), p)) : [],
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    help: { type: 'boolean' }, script: { type: 'string' }, model: { type: 'string' },
    provider: { type: 'string' }, 'ollama-url': { type: 'string' },
    strategies: { type: 'string' }, repeats: { type: 'string' }, scripts: { type: 'string' },
    scripted: { type: 'boolean' },
    port: { type: 'string' }, workspace: { type: 'string' },
    'data-dir': { type: 'string' }, 'accept-workspace': { type: 'boolean' }, 'confirm-owner-stopped': { type: 'boolean' },
  } });
  if (values.help || positionals.length === 0) { console.log(help); return; }
  const [command, target] = positionals;
  if (['doctor', 'dashboard', 'mcp'].includes(command!)) {
    if (positionals.length !== 1) throw new Error('This command takes no positional target');
    if (values.script || values.scripts || values.scripted || values.strategies || values.repeats || values['accept-workspace'] || values['confirm-owner-stopped']) throw new Error('Run/comparison options do not apply to this command');
    if (command === 'doctor') { console.log(JSON.stringify(await doctor(values.model ?? process.env.TILLER_MODEL), null, 2)); return; }
    const store = new Store(values['data-dir'] ?? '.tiller');
    try {
      if (command === 'dashboard') {
        const port = Number(values.port ?? '0'); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0-65535');
        const { startDashboard } = await import('./interfaces/dashboard.js');
        const result = await startDashboard(store, port); console.log(`Tiller dashboard: ${result.url}`);
        await new Promise<void>((done) => {
          const stop = () => result.server.close(() => done());
          process.once('SIGINT', stop); process.once('SIGTERM', stop);
        });
      } else {
        const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
        const { createMcp } = await import('./interfaces/mcp.js');
        const mcp = createMcp(store, resolve(values.workspace ?? '.'), values.model ?? process.env.TILLER_MODEL ?? 'lfm2.5:8b');
        await mcp.server.connect(new StdioServerTransport());
        await new Promise<void>((done) => {
          let stopping = false;
          const stop = () => { if (stopping) return; stopping = true; void mcp.stop().then(() => mcp.server.close()).finally(done); };
          process.once('SIGINT', stop); process.once('SIGTERM', stop); process.stdin.once('end', stop);
        });
      }
    } finally { store.close(); }
    return;
  }
  if (values.port || values.workspace) throw new Error('--port/--workspace apply to dashboard/MCP only');
  if (positionals.length !== 2 || !target) throw new Error('Expected a command and task file/run ID; see --help');
  if (!['run', 'resume', 'inspect', 'trace', 'diff', 'cancel', 'reconcile', 'unlock', 'validate', 'compare', 'evaluate'].includes(command!))
    throw new Error(`Unknown command: ${command}`);
  if ((values.script || values.model || values.provider || values['ollama-url']) && !['run', 'resume', 'compare', 'evaluate'].includes(command!)) throw new Error('Adapter options only apply to run/resume/compare/evaluate');
  if ((values.strategies || values.repeats) && !['compare', 'evaluate'].includes(command!)) throw new Error('Comparison options only apply to compare/evaluate');
  if (values.scripts && command !== 'compare') throw new Error('--scripts only applies to compare');
  if (values.scripted && command !== 'evaluate') throw new Error('--scripted only applies to evaluate');
  if (command === 'evaluate' && values.script) throw new Error('Use --scripted with suite script mappings');
  if (values.scripted && (values.model || values.provider || values['ollama-url'])) throw new Error('Use either --scripted or provider options');
  if (command === 'compare' && values.script) throw new Error('Use --scripts for per-strategy comparison fixtures');
  if (values.scripts && (values.model || values.provider || values['ollama-url'])) throw new Error('Use either --scripts or provider options');
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
    if (command === 'evaluate') {
      const conditions = (values.strategies?.split(',') ?? strategies) as Strategy[];
      const controller = new AbortController();
      const pause = () => controller.abort();
      process.on('SIGINT', pause); process.on('SIGTERM', pause);
      try {
        const result = await evaluateSuite(store, target, conditions, Number(values.repeats ?? '1'),
          (_strategy, script) => adapterFor(script, values.model, values.provider, values['ollama-url']),
          values.scripted ?? false, controller.signal);
        console.log(JSON.stringify({ path: result.path, status: result.report.status, error: result.report.error,
          cases: result.report.results.map((entry) => ({ id: entry.caseId, path: entry.path, rows: entry.report.rows })) }, null, 2));
        process.exitCode = result.report.status === 'completed' ? 0 : 2;
      } finally { process.off('SIGINT', pause); process.off('SIGTERM', pause); }
    } else if (command === 'compare') {
      const conditions = (values.strategies?.split(',') ?? strategies) as Strategy[];
      const repeats = Number(values.repeats ?? '1');
      let getAdapter: (strategy: Strategy) => Adapter;
      if (values.scripts) {
        const file = resolve(values.scripts);
        const mapping: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Expected strategy-to-script JSON object');
        getAdapter = (strategy) => {
          const path = (mapping as Record<string, unknown>)[strategy];
          if (typeof path !== 'string') throw new Error(`Missing script for ${strategy}`);
          return ScriptedAdapter.fromFile(resolve(dirname(file), path));
        };
      } else {
        const adapter = adapterFor(undefined, values.model, values.provider, values['ollama-url']);
        getAdapter = () => adapter;
      }
      const controller = new AbortController();
      const pause = () => controller.abort();
      process.on('SIGINT', pause); process.on('SIGTERM', pause);
      try {
        const result = await compare(store, loadTask(), conditions, repeats, getAdapter, controller.signal);
        console.log(JSON.stringify({ path: result.path, status: result.report.status, error: result.report.error, rows: result.report.rows }, null, 2));
        process.exitCode = result.report.status === 'completed' ? 0 : 2;
      } finally { process.off('SIGINT', pause); process.off('SIGTERM', pause); }
    } else if (command === 'run' || command === 'resume') {
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
