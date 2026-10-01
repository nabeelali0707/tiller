import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { taskSchema } from '../core/contracts.js';
import { safeFile } from '../tools/workspace.js';
import { createRun, execute } from '../executors/runtime.js';
import { OllamaAdapter } from '../adapters/ollama.js';
import { Store } from '../storage/store.js';
import { runView } from './view.js';

export function scopedTask(root: string, file: string) {
  const base = realpathSync(root); const path = resolve(base, file);
  const name = relative(base, path).split(sep).join('/');
  const manifest = safeFile(base, name);
  const task = taskSchema.parse(JSON.parse(readFileSync(manifest, 'utf8')) as unknown);
  const repository = realpathSync(resolve(dirname(manifest), task.repository));
  const relation = relative(base, repository);
  if (relation.startsWith('..') || resolve(base, relation) !== repository || relation.includes(':'))
    throw new Error('Task repository must be inside the configured workspace');
  if (task.execution?.mode !== 'docker') throw new Error('MCP execution requires a Docker task; trusted-local runs use the CLI');
  return { ...task, repository };
}

export class RunService {
  private active = new Map<string, { controller: AbortController; promise: Promise<unknown> }>();
  constructor(readonly store: Store, private root: string, private model: string, private think?: boolean) {}
  start(file: string) {
    if (this.active.size) throw new Error('This server already has an active run');
    const task = scopedTask(this.root, file); const adapter = new OllamaAdapter(this.model, undefined, undefined, this.think === undefined ? {} : { think: this.think });
    const run = createRun(this.store, task, adapter); this.launch(run.id, adapter);
    return runView(this.store, run);
  }
  resume(id: string) {
    if (this.active.size) throw new Error('This server already has an active run');
    const run = this.store.load(id);
    const base = realpathSync(this.root); const relation = relative(base, realpathSync(run.task.repository));
    if (relation.startsWith('..') || relation.includes(':') || run.task.execution?.mode !== 'docker') throw new Error('Run is outside the configured execution scope');
    const adapter = new OllamaAdapter(this.model, undefined, undefined, this.think === undefined ? {} : { think: this.think });
    if (run.adapter !== adapter.id) throw new Error('Configured model must match the original run adapter');
    if (run.pending && run.pending.kind !== 'candidate') throw new Error('Inspect and reconcile the pending operation with the CLI first');
    if (!['paused', 'ready', 'running', 'verifying'].includes(run.status)) throw new Error('Run cannot resume');
    this.launch(id, adapter); return runView(this.store, run);
  }
  private launch(id: string, adapter: OllamaAdapter) {
    const controller = new AbortController();
    // Scheduling defers dispatch until the start response has returned its run ID.
    const promise = new Promise<void>((done) => setImmediate(done)).then(() => execute(this.store, id, adapter, controller.signal))
      .catch(() => undefined).finally(() => this.active.delete(id));
    this.active.set(id, { controller, promise });
  }
  async stop() {
    for (const entry of this.active.values()) entry.controller.abort();
    await Promise.all([...this.active.values()].map((entry) => entry.promise));
  }
}
