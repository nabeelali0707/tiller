import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Task } from '../core/contracts.js';
import { runCheck } from './checks.js';
import type { CheckResult } from './checks.js';
export interface SandboxServices {
  prepare(image: string): Promise<string>;
  check: typeof sandboxCheck;
}
export const sandboxServices: SandboxServices = { prepare: prepareSandbox, check: sandboxCheck };

export function docker(args: string[], timeout = 15_000): Promise<string> {
  return new Promise((done, reject) => execFile('docker', args,
    { windowsHide: true, timeout, maxBuffer: 128_000 }, (error, output) => {
      if (error) reject(new Error(`Docker operation failed: ${args[0]}. Check the local engine and installed image.`));
      else done(output.trim());
    }));
}

export async function prepareSandbox(image: string): Promise<string> {
  const context = JSON.parse(await docker(['context', 'inspect'])) as { Endpoints?: { docker?: { Host?: string } } }[];
  const endpoint = context[0]?.Endpoints?.docker?.Host ?? '';
  if (!endpoint.startsWith('unix://') && !endpoint.startsWith('npipe://')) throw new Error('Sandbox requires a local Docker engine');
  const info = JSON.parse(await docker(['info', '--format', '{{json .}}'])) as { OSType?: string; SecurityOptions?: string[] };
  if (info.OSType !== 'linux' || !info.SecurityOptions?.some((option) => option.includes('seccomp')))
    throw new Error('Sandbox requires Linux containers with seccomp enabled');
  const imageId = await docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Docker returned an invalid image identity');
  return imageId;
}

export function sandboxArgs(image: string, workspace: string, name: string, args: string[]): string[] {
  const path = resolve(workspace);
  if (path.includes(',') || /[\r\n]/.test(path)) throw new Error('Sandbox mount path cannot contain commas or newlines');
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || !/^tiller-[a-f0-9-]{36}$/.test(name)) throw new Error('Invalid sandbox identity');
  return ['run', '--rm', '--name', name, '--pull', 'never', '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534',
    '--pids-limit', '64', '--memory', '256m', '--memory-swap', '256m', '--cpus', '1',
    '--ulimit', 'nofile=128:128', '--init', '--no-healthcheck',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
    '--mount', `type=bind,source=${path},target=/workspace,readonly`, '--workdir', '/workspace',
    '--entrypoint', '/usr/local/bin/node', image, ...args];
}

export async function sandboxCheck(check: Task['checks'][number], workspace: string, image: string,
  signal: AbortSignal, timeoutMs: number, operationId: string = randomUUID()): Promise<CheckResult> {
  if (check.command !== 'node') throw new Error('Sandbox supports node checks only');
  const name = `tiller-${operationId}`;
  try {
    return await runCheck({ ...check, command: 'docker', args: sandboxArgs(image, workspace, name, check.args) }, workspace, signal, timeoutMs);
  } finally {
    // Killing the Docker client alone does not terminate its container.
    // A second removal handles a create/termination race; names are unique per intent.
    await docker(['rm', '--force', name]).catch(() => undefined);
    const remaining = await docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']);
    if (remaining) { await docker(['rm', '--force', name]); }
  }
}
