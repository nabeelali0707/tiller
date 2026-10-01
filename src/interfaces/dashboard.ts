import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Store } from '../storage/store.js';
import { runView, timeline } from './view.js';
import { redact } from '../security/redaction.js';
import { html, css, js } from './dashboard-assets.js';

export async function startDashboard(store: Store, port = 0) {
  const token = randomBytes(32).toString('hex'); let origin = '';
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (status: number, value: unknown, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type }); response.end(type === 'application/json' ? JSON.stringify(value) : String(value));
    };
    if (`http://${request.headers.host}` !== origin || (request.headers.origin && request.headers.origin !== origin)) { send(403, { error: 'Origin denied' }); return; }
    const path = request.url ?? '/';
    if (request.method === 'GET' && path === '/') { send(200, html, 'text/html; charset=utf-8'); return; }
    if (request.method === 'GET' && path === '/app.js') { send(200, js, 'text/javascript'); return; }
    if (request.method === 'GET' && path === '/style.css') { send(200, css, 'text/css'); return; }
    const supplied = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (Buffer.byteLength(supplied) !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { send(401, { error: 'Authentication required' }); return; }
    try {
      if (request.method === 'GET' && path === '/api/runs') { send(200, store.list().map((run) => runView(store, run))); return; }
      const match = /^\/api\/runs\/([a-f0-9-]{36})(?:\/(events|patch|cancel))?$/.exec(path);
      if (!match) { send(404, { error: 'Not found' }); return; }
      const id = match[1]!; const run = store.load(id); const action = match[2];
      if (request.method === 'POST' && action === 'cancel') { store.cancel(id); send(200, { cancellationRequested: true }); return; }
      if (request.method !== 'GET') { send(405, { error: 'Method denied' }); return; }
      if (!action) send(200, runView(store, run));
      else if (action === 'events') send(200, timeline(store, id));
      else if (action === 'patch' && run.status === 'succeeded') send(200, { patch: redact(readFileSync(join(store.directory(id), 'changes.patch'), 'utf8')) });
      else send(404, { error: 'Artifact unavailable' });
    } catch { send(404, { error: 'Run or artifact unavailable' }); }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => done()); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url: `${origin}/#${token}` };
}
