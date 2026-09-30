import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { relativeFile } from '../core/contracts.js';
import type { Run, Task } from '../core/contracts.js';

export const MAX_FILE_BYTES = 64_000;
export function hash(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex'); }

export function safeFile(root: string, relative: string): string {
  relativeFile.parse(relative);
  const base = realpathSync(root);
  let current = base;
  for (const component of relative.split('/')) {
    current = join(current, component);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${relative}`);
  }
  const full = realpathSync(current);
  if (!full.startsWith(base + sep)) throw new Error('Path escapes workspace');
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES)
    throw new Error(`Expected a single-link regular file <= ${MAX_FILE_BYTES} bytes: ${relative}`);
  return full;
}

export function snapshot(task: Task, directory: string): Record<string, string> {
  const original = join(directory, 'original');
  const workspace = join(directory, 'workspace');
  mkdirSync(original, { recursive: true }); mkdirSync(workspace, { recursive: true });
  let size = 0;
  for (const file of task.files) {
    const source = safeFile(resolve(task.repository), file);
    size += lstatSync(source).size;
    if (size > 4_000_000) throw new Error('Snapshot exceeds 4 MB limit for this prototype');
    for (const targetRoot of [original, workspace]) {
      const target = join(targetRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
  }
  return hashes(task, workspace);
}

export function hashes(task: Task, workspace: string): Record<string, string> {
  return Object.fromEntries(task.files.map((file) => [file, hash(readFileSync(safeFile(workspace, file)))]));
}

export function assertCheckpoint(run: Run, workspace: string): void {
  const now = hashes(run.task, workspace);
  if (JSON.stringify(now) !== JSON.stringify(run.hashes))
    throw new Error('Workspace changed outside the last recorded operation; inspect and reconcile before resume');
}

export function assertProtected(run: Run, directory: string): void {
  for (const file of run.task.files.filter((p) => !run.task.editable.includes(p))) {
    const before = readFileSync(safeFile(join(directory, 'original'), file));
    const after = readFileSync(safeFile(join(directory, 'workspace'), file));
    if (!before.equals(after)) throw new Error(`Protected file changed: ${file}`);
  }
}

export function readAllowed(run: Run, workspace: string, file: string): string {
  if (!run.task.files.includes(file)) throw new Error(`Read denied: ${file}`);
  return readFileSync(safeFile(workspace, file), 'utf8');
}

export function writeAllowed(run: Run, workspace: string, file: string, content: string): void {
  if (!run.task.editable.includes(file)) throw new Error(`Write denied: ${file}`);
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('Content exceeds file byte limit');
  writeFileSync(safeFile(workspace, file), content, 'utf8');
}

export function changes(run: Run, directory: string): unknown[] {
  return run.task.editable.flatMap((file) => {
    const before = readFileSync(safeFile(join(directory, 'original'), file), 'utf8');
    const after = readFileSync(safeFile(join(directory, 'workspace'), file), 'utf8');
    return before === after ? [] : [{ path: file, before, after, beforeHash: hash(before), afterHash: hash(after) }];
  });
}
