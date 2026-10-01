// Known repairs generate deterministic control fixtures, never model-performance evidence.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
const repairs = [
  { id: 'validation', check: 'discount', files: ['discount.cjs'], fixes: [
    "exports.discount = (price, percent) => {\n  if (!Number.isFinite(price) || !Number.isFinite(percent) || price < 0 || percent < 0 || percent > 100) throw new RangeError('Invalid discount inputs');\n  return price * (1 - percent / 100);\n};\n",
  ] },
  { id: 'dependencies', check: 'lookup', files: ['normalize.cjs', 'lookup.cjs'], fixes: [
    "exports.normalize = (value) => value.trim().toLowerCase();\n",
    "const { normalize } = require('./normalize.cjs');\nexports.lookup = (users, email) => users.find((user) => normalize(user.email) === normalize(email));\n",
  ] },
];
for (const repair of repairs) {
  const dir = join(base, repair.id, 'scripts'); mkdirSync(dir, { recursive: true });
  const reads = repair.files.map((path) => ({ reason: 'Inspect declared source.', action: { type: 'read', path } }));
  const writes = repair.files.map((path, index) => ({ reason: 'Apply the known fixture repair.', action: { type: 'write', path, content: repair.fixes[index] } }));
  const complete = { reason: 'Request real acceptance checks.', action: { type: 'complete', summary: 'Known fixture repair applied.' } };
  const flat = [...reads, ...writes, complete];
  const sequential = flat.map((decision) => ({ ...decision, remainingPlan: ['Inspect, repair and verify the declared behavior'] }));
  const hierarchy = [
    { reason: 'Gate repair on source inspection.', action: { type: 'decompose', nodes: [
      { id: 'root', parentId: null, goal: 'Repair the declared behavior', dependsOn: [], acceptance: { type: 'children' } },
      { id: 'inspect', parentId: 'root', goal: 'Read all affected source files', dependsOn: [], acceptance: { type: 'read', paths: repair.files } },
      { id: 'repair', parentId: 'root', goal: 'Repair and verify', dependsOn: ['inspect'], acceptance: { type: 'checks', checkIds: [repair.check] } },
    ] } },
    ...reads.map((decision) => ({ ...decision, nodeId: 'inspect', remainingPlan: ['Read required files'] })),
    { ...complete, nodeId: 'inspect', remainingPlan: ['Finish inspection'] },
    ...writes.map((decision) => ({ ...decision, nodeId: 'repair', remainingPlan: ['Apply repair and verify'] })),
    { ...complete, nodeId: 'repair', remainingPlan: ['Verify repair'] },
  ];
  const plan = [{ reason: 'Declare an initial contextual plan.', action: { type: 'plan', steps: ['Read source', 'Repair behavior', 'Verify'] } }, ...flat];
  for (const [strategy, script] of Object.entries({ 'flat-react': flat, 'plan-react': plan, sequential, hierarchical: hierarchy }))
    writeFileSync(join(dir, `${strategy}.json`), JSON.stringify(script, null, 2) + '\n');
}
