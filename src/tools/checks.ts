import { spawn } from 'node:child_process';
import type { Task } from '../core/contracts.js';

export interface CheckResult {
  checkId: string;
  passed: boolean;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
}

// Deliberately do not forward provider keys, NODE_OPTIONS, or arbitrary secrets.
function checkEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG'];
  return Object.fromEntries(Object.entries(process.env)
    .filter(([key, value]) => value !== undefined && allowed.includes(key.toUpperCase())));
}

export async function runCheck(check: Task['checks'][number], cwd: string, signal: AbortSignal, timeoutMs: number): Promise<CheckResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(check.command === 'node' ? process.execPath : check.command, check.args, {
      cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      env: checkEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let stopping = false;
    let killTask: Promise<void> | undefined;
    const collect = (chunk: Buffer) => {
      const remaining = Math.max(0, 16_384 - output.length);
      if (chunk.length > remaining) truncated = true;
      output = Buffer.concat([output, chunk.subarray(0, remaining)]);
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const stop = () => {
      if (stopping || !child.pid) return;
      stopping = true;
      const pid = child.pid;
      if (process.platform === 'win32') {
        killTask = new Promise<void>((done) => {
          const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => { child.kill('SIGKILL'); done(); });
          killer.on('close', () => done());
        });
      } else {
        try { process.kill(-pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, Math.max(1, Math.min(check.timeoutMs, timeoutMs)));
    const onAbort = () => stop();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) stop();
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); };
    child.on('error', (error) => { cleanup(); reject(error); });
    child.on('close', (exitCode) => {
      cleanup();
      void (async () => {
        await killTask;
        resolve({ checkId: check.id, passed: exitCode === 0 && !timedOut && !signal.aborted,
          exitCode, output: output.toString('utf8'), truncated, timedOut, aborted: signal.aborted });
      })();
    });
  });
}
