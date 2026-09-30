import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/);
export const planNodeSchema = z.object({
  id, parentId: id.nullable(), goal: z.string().min(1).max(500),
  dependsOn: z.array(id).max(12),
  acceptance: z.discriminatedUnion('type', [
    z.object({ type: z.literal('children') }).strict(),
    z.object({ type: z.literal('read'), paths: z.array(z.string().min(1)).min(1).max(20) }).strict(),
    z.object({ type: z.literal('checks'), checkIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)).min(1).max(10) }).strict(),
  ]),
}).strict();
export const planTreeSchema = z.array(planNodeSchema).min(3).max(24);
export type PlanNode = z.infer<typeof planNodeSchema>;
export interface NodeProgress {
  status: 'pending' | 'active' | 'completed';
  reads: Record<string, string>;
  summary?: string;
}
export interface Hierarchy {
  nodes: PlanNode[];
  progress: Record<string, NodeProgress>;
  activeId: string | null;
}

export function buildHierarchy(input: unknown, files: string[], checkIds: string[]): Hierarchy {
  const nodes = planTreeSchema.parse(input);
  const ids = nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) throw new Error('Hierarchy node IDs must be unique');
  const roots = nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) throw new Error('Hierarchy must have exactly one root');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const ancestors = new Set([node.id]);
    let cursor = node;
    while (cursor.parentId !== null) {
      const parent = byId.get(cursor.parentId);
      if (!parent) throw new Error(`Unknown parent ${cursor.parentId}`);
      if (ancestors.has(parent.id)) throw new Error('Cycle in hierarchy parent links');
      ancestors.add(parent.id);
      if (ancestors.size > 4) throw new Error('Hierarchy exceeds depth limit of 4');
      cursor = parent;
    }
    const children = nodes.filter((n) => n.parentId === node.id);
    if (node.acceptance.type === 'children') {
      if (children.length < 2) throw new Error(`Parent ${node.id} requires at least two children`);
    } else {
      if (children.length) throw new Error(`Leaf ${node.id} cannot have children`);
      const references = node.acceptance.type === 'read' ? node.acceptance.paths : node.acceptance.checkIds;
      const allowed = node.acceptance.type === 'read' ? files : checkIds;
      if (new Set(references).size !== references.length || references.some((value) => !allowed.includes(value)))
        throw new Error(`Unknown or duplicated acceptance references on ${node.id}`);
    }
    if (new Set(node.dependsOn).size !== node.dependsOn.length) throw new Error('Duplicate dependencies');
    for (const dependency of node.dependsOn) {
      const other = byId.get(dependency);
      if (!other || other.id === node.id || other.parentId !== node.parentId)
        throw new Error(`Dependencies must reference other siblings: ${node.id} -> ${dependency}`);
    }
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (node: PlanNode) => {
    if (visiting.has(node.id)) throw new Error('Cycle in hierarchy dependencies');
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    for (const dep of node.dependsOn) visit(byId.get(dep)!);
    visiting.delete(node.id); visited.add(node.id);
  };
  nodes.forEach(visit);
  return { nodes, progress: Object.fromEntries(nodes.map((node) => [node.id, { status: 'pending', reads: {} }])), activeId: null };
}

export function nextLeaf(tree: Hierarchy): PlanNode | undefined {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  return tree.nodes.find((node) => {
    if (node.acceptance.type === 'children' || tree.progress[node.id]!.status === 'completed') return false;
    let cursor: PlanNode | undefined = node;
    while (cursor) {
      if (cursor.dependsOn.some((dep) => tree.progress[dep]!.status !== 'completed')) return false;
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return true;
  });
}

export function completeLeaf(tree: Hierarchy, node: PlanNode, summary: string): string[] {
  tree.progress[node.id]!.status = 'completed'; tree.progress[node.id]!.summary = summary;
  tree.activeId = null;
  const completed = [node.id];
  let changed = true;
  while (changed) {
    changed = false;
    for (const parent of tree.nodes.filter((n) => n.acceptance.type === 'children')) {
      if (tree.progress[parent.id]!.status !== 'completed' && tree.nodes.filter((n) => n.parentId === parent.id)
        .every((child) => tree.progress[child.id]!.status === 'completed')) {
        tree.progress[parent.id]!.status = 'completed';
        tree.progress[parent.id]!.summary = tree.nodes.filter((n) => n.parentId === parent.id)
          .map((child) => `${child.id}: ${tree.progress[child.id]!.summary ?? 'Evidence recorded'}`).join('\n').slice(0,4000);
        completed.push(parent.id); changed = true;
      }
    }
  }
  return completed;
}

// Read nodes record observations at a point in time. Check-backed claims describe current code,
// so writes/reconciliation invalidate those claims and their parent summaries.
export function invalidateChecks(tree: Hierarchy): string[] {
  const invalidated: string[] = [];
  for (const node of tree.nodes) {
    if (node.acceptance.type === 'checks' && tree.progress[node.id]!.status === 'completed') {
      tree.progress[node.id] = { status: 'pending', reads: {} }; invalidated.push(node.id);
      let parent = tree.nodes.find((n) => n.id === node.parentId);
      while (parent) {
        if (tree.progress[parent.id]!.status === 'completed') {
          tree.progress[parent.id] = { status: 'pending', reads: {} }; invalidated.push(parent.id);
        }
        parent = tree.nodes.find((n) => n.id === parent!.parentId);
      }
    }
  }
  return invalidated;
}
