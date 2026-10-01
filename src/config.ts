import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** Load only Tiller settings, preserving shell overrides. */
export function loadConfig(path = '.env', env: NodeJS.ProcessEnv = process.env): void {
  let contents: string;
  try { contents = readFileSync(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('Cannot read .env; check file permissions');
  }
  const values = parseEnv(contents);
  for (const key of ['OPENAI_API_KEY', 'TILLER_PROVIDER', 'TILLER_MODEL']) {
    if (env[key] === undefined && values[key] !== undefined) env[key] = values[key];
  }
}
