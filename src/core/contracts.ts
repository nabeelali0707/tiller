import { z } from 'zod';
import { planTreeSchema } from './hierarchy.js';
import type { Hierarchy } from './hierarchy.js';

export const relativeFile = z.string().min(1).max(240).refine((p) =>
  !p.includes('\\') && !p.includes(':') && !p.startsWith('/') &&
  p.split('/').every((part) => part !== '' && part !== '.' && part !== '..' &&
    !part.endsWith('.') && !part.endsWith(' ') && !/[\x00-\x1f<>"|?*]/.test(part) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) &&
  !p.split('/').some((part) => ['.git', '.tiller'].includes(part.toLowerCase())),
  'Expected a portable relative file path without traversal or metadata directories');

export const taskSchema = z.object({
  version: z.literal(1),
  goal: z.string().min(1).max(12_000),
  strategy: z.enum(['sequential', 'hierarchical']).default('sequential'),
  repository: z.string().min(1),
  files: z.array(relativeFile).min(1).max(200),
  editable: z.array(relativeFile).min(1).max(100),
  checks: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    command: z.string().min(1),
    args: z.array(z.string()).max(50),
    timeoutMs: z.number().int().min(100).max(120_000).default(15_000),
  }).strict()).min(1).max(10),
  budget: z.object({
    maxModelCalls: z.number().int().min(1).max(100).default(12),
    maxToolCalls: z.number().int().min(2).max(500).default(30),
    maxDurationMs: z.number().int().min(1000).max(3_600_000).default(300_000),
    maxOutputTokensPerCall: z.number().int().min(256).max(16_384).default(4096),
  }).strict().default({ maxModelCalls: 12, maxToolCalls: 30, maxDurationMs: 300_000, maxOutputTokensPerCall: 4096 }),
}).strict().superRefine((t, ctx) => {
  const unique = (xs: string[]) => new Set(xs.map((s) => s.toLowerCase())).size === xs.length;
  if (!unique(t.files) || !unique(t.editable) || !unique(t.checks.map((c) => c.id)))
    ctx.addIssue({ code: 'custom', message: 'File, editable, and check identifiers must be unique (case-insensitive)' });
  if (t.editable.some((p) => !t.files.includes(p)))
    ctx.addIssue({ code: 'custom', message: 'Editable files must be explicitly included in files' });
  if (t.budget.maxToolCalls < 2 * t.checks.length)
    ctx.addIssue({ code: 'custom', message: 'Tool budget must cover baseline and final verification' });
});
export type Task = z.infer<typeof taskSchema>;

export const decisionSchema = z.object({
  nodeId: z.string().optional(),
  remainingPlan: z.array(z.string().min(1).max(500)).min(1).max(8),
  reason: z.string().min(1).max(2000),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('read'), path: relativeFile }).strict(),
    z.object({ type: z.literal('write'), path: relativeFile, content: z.string().max(64_000) }).strict(),
    z.object({ type: z.literal('check'), checkId: z.string().min(1) }).strict(),
    z.object({ type: z.literal('complete'), summary: z.string().min(1).max(2000) }).strict(),
    z.object({ type: z.literal('decompose'), nodes: planTreeSchema }).strict(),
  ]),
}).strict();
export type Decision = z.infer<typeof decisionSchema>;
export type Action = Decision['action'];
export type Status = 'ready' | 'running' | 'verifying' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'budget_exhausted';
export interface Observation { type: string; result: unknown }
export interface Run {
  version: 1;
  id: string;
  task: Task;
  adapter: string;
  status: Status;
  createdAt: number;
  deadline: number | null;
  calls: number;
  tools: number;
  inputTokens: number;
  outputTokens: number;
  unknownUsageCalls: number;
  decisionIndex: number;
  planVersion: number;
  remainingPlan: string[];
  pending: { id: string; kind: string; detail: unknown; nodeId?: string | null } | null;
  hashes: Record<string, string>;
  baselineDone: boolean;
  observations: Observation[];
  message: string;
  hierarchy?: Hierarchy;
}
export interface AdapterReply { decision: unknown; usage?: { inputTokens: number; outputTokens: number } }
export interface Adapter {
  readonly id: string;
  next(run: Readonly<Run>, signal: AbortSignal): Promise<AdapterReply>;
}

const transitions: Record<Status, Status[]> = {
  ready: ['running', 'cancelled'],
  running: ['verifying', 'paused', 'failed', 'cancelled', 'budget_exhausted'],
  verifying: ['running', 'succeeded', 'paused', 'failed', 'cancelled', 'budget_exhausted'],
  paused: ['running', 'cancelled', 'budget_exhausted'],
  succeeded: [], failed: [], cancelled: [], budget_exhausted: [],
};
export function transition(run: Run, status: Status, message = ''): void {
  if (run.status !== status && !transitions[run.status].includes(status))
    throw new Error(`Invalid transition ${run.status} -> ${status}`);
  run.status = status;
  run.message = message;
}

export class BudgetError extends Error {}
export function reserve(run: Run, kind: 'model' | 'tool', count = 1, finalVerification = false): void {
  if (run.deadline !== null && Date.now() >= run.deadline) throw new BudgetError('Run deadline reached');
  if (kind === 'model') {
    if (run.calls + count > run.task.budget.maxModelCalls) throw new BudgetError('Model call limit reached');
    run.calls += count;
    // Until a response is accounted for, usage is conservatively unknown.
    run.unknownUsageCalls += count;
  } else {
    const verificationReserve = finalVerification ? 0 : run.task.checks.length;
    if (run.tools + count + verificationReserve > run.task.budget.maxToolCalls)
      throw new BudgetError('Tool limit reached (final verification capacity reserved)');
    run.tools += count;
  }
}
