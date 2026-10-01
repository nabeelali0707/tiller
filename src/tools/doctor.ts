import { prepareSandbox } from './sandbox.js';
import { OllamaAdapter } from '../adapters/ollama.js';
export async function doctor(model = 'lfm2.5:8b') {
  const status: { node: string; model: string; ollama: unknown; docker: unknown } = { node: process.version, model, ollama: null, docker: null };
  const results = await Promise.allSettled([
    (async () => {
      const adapter = new OllamaAdapter(model);
      const response = await fetch(`${adapter.endpoint}/api/show`, { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
      if (!response.ok) throw new Error('Model is not installed or local Ollama is unavailable');
      const body = await response.json() as { capabilities?: string[]; details?: unknown; remote_host?: unknown };
      if (body.remote_host) throw new Error('Selected model is remote');
      return { available: true, capabilities: body.capabilities ?? [], details: body.details ?? null, liveCodingVerified: false };
    })(), prepareSandbox('node:24-alpine').then((image) => ({ available: true, image, liveIsolationVerified: false })),
  ]);
  status.ollama = results[0]!.status === 'fulfilled' ? results[0]!.value : { available: false, reason: String(results[0]!.reason) };
  status.docker = results[1]!.status === 'fulfilled' ? results[1]!.value : { available: false, reason: String(results[1]!.reason) };
  return status;
}
