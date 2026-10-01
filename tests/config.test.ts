import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

test('env loads quoted keys, preserves shell values and ignores unrelated settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiller-config-'));
  try {
    const path = join(dir, '.env');
    writeFileSync(path, 'OPENAI_API_KEY="test-only-key"\nTILLER_PROVIDER=openai\nTILLER_MODEL=gpt-4.1\nNODE_OPTIONS=unsafe\n');
    const env: NodeJS.ProcessEnv = { TILLER_MODEL: 'shell-model' };
    loadConfig(path, env);
    assert.deepEqual(env, { OPENAI_API_KEY: 'test-only-key', TILLER_PROVIDER: 'openai', TILLER_MODEL: 'shell-model' });
    loadConfig(join(dir, 'missing'), env);
    assert.equal(env.TILLER_MODEL, 'shell-model');
    assert.throws(() => loadConfig(dir, env), /Cannot read .env/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
