import { existsSync, lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const output = join(root, 'dist');
if (existsSync(output)) {
  const stat = lstatSync(output);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(output) !== output) throw new Error('Refusing to clean an unexpected build output path');
  rmSync(output, { recursive: true, force: true });
}
const compilerPackage = join(root, 'node_modules/typescript');
const metadata = JSON.parse(readFileSync(join(compilerPackage, 'package.json'), 'utf8'));
const result = spawnSync(process.execPath, [join(compilerPackage, metadata.bin.tsc)], {
  cwd: root, stdio: 'inherit', windowsHide: true,
});
process.exitCode = result.status ?? 1;
