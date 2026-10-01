import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { Store } from '../storage/store.js';
import { safeFile } from '../tools/workspace.js';
import { RunService } from './service.js';
import { runView, timeline } from './view.js';
import { redact } from '../security/redaction.js';

export function createMcp(store: Store, root: string, model: string) {
  const server = new McpServer({ name: 'tiller', version: '0.2.0' });
  const service = new RunService(store, root, model);
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  const idSchema = z.object({ runId: z.string().uuid() });
  server.registerTool('list_runs', { description: 'List recent local Tiller runs. These are runtime observations.', inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => result(store.list().map((run) => runView(store, run))));
  server.registerTool('start_run', { description: 'Start one bounded Docker task inside the configured workspace using the configured local Ollama model. Owns only Tiller tools; does not control other host-agent actions.', inputSchema: z.object({ taskFile: z.string().min(1) }) },
    async ({ taskFile }) => result(service.start(taskFile)));
  server.registerTool('get_run', { description: 'Inspect persisted Tiller state and budget counters.', inputSchema: idSchema, annotations: { readOnlyHint: true } },
    async ({ runId }) => result(runView(store, store.load(runId))));
  server.registerTool('get_timeline', { description: 'Read observed events with whole-file content omitted and sensitive values masked.', inputSchema: idSchema, annotations: { readOnlyHint: true } },
    async ({ runId }) => result(timeline(store, runId)));
  server.registerTool('cancel_run', { description: 'Request cancellation; does not undo existing changes.', inputSchema: idSchema },
    async ({ runId }) => { store.cancel(runId); return result({ cancellationRequested: true }); });
  server.registerTool('resume_run', { description: 'Resume a scoped Docker run with the same local model; unresolved side effects require CLI reconciliation first.', inputSchema: idSchema },
    async ({ runId }) => result(service.resume(runId)));
  server.registerTool('get_artifact', { description: 'Read a masked verified patch preview. Use the original CLI patch for application after review.', inputSchema: idSchema, annotations: { readOnlyHint: true } },
    async ({ runId }) => {
      const run = store.load(runId); if (run.status !== 'succeeded') throw new Error('No verified artifact is available');
      return result({ patch: redact(readFileSync(safeFile(store.directory(runId), 'changes.patch'), 'utf8')) });
    });
  return { server, stop: () => service.stop() };
}
