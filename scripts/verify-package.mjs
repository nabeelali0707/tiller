import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const archive = resolve('output/tiller-runtime-0.2.0.tgz');
const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
assert.ok(files.some((file) => file === 'package/dist/src/cli.js'));
assert.ok(files.some((file) => file === 'package/dist/src/interfaces/mcp.js'));
assert.ok(files.some((file) => file === 'package/dist/src/executors/search.js'));
for (const file of files) {
  assert.doesNotMatch(file, /(?:^|\/)(?:\.tiller|\.git|node_modules|tmp|tests)(?:\/|$)/);
  assert.doesNotMatch(file, /(?:^|\/)\.env(?:$|\.)/);
  assert.notEqual(file, 'package/dist/src/executors/sequential.js', 'Stale compiled source must not be packaged');
}
console.log(`Verified ${files.length} package entries; no run data, credentials, dependencies, tests or stale executor included.`);
