import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Run } from '../core/contracts.js';

export interface Event { seq: number; at: number; type: string; data: unknown }
export class Store {
  readonly root: string;
  private db: DatabaseSync;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
    this.db = new DatabaseSync(join(this.root, 'runs.sqlite'), { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, state TEXT NOT NULL, cancel INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);`);
  }
  directory(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid run ID');
    return join(this.root, 'runs', id);
  }
  save(run: Run, type: string, data: unknown = {}): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO runs(id,state) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state')
        .run(run.id, JSON.stringify(run));
      this.db.prepare('INSERT INTO events(run_id,at,type,data) VALUES (?,?,?,?)')
        .run(run.id, Date.now(), type, JSON.stringify(data));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  load(id: string): Run {
    this.directory(id);
    const row = this.db.prepare('SELECT state FROM runs WHERE id=?').get(id);
    if (!row) throw new Error(`Unknown run ${id}`);
    const run = JSON.parse(row.state as string) as Run;
    if (run.version !== 1) throw new Error('Unsupported saved run version');
    return run;
  }
  events(id: string): Event[] {
    this.load(id);
    return this.db.prepare('SELECT seq,at,type,data FROM events WHERE run_id=? ORDER BY seq').all(id)
      .map((r) => ({ seq: r.seq as number, at: r.at as number, type: r.type as string, data: JSON.parse(r.data as string) as unknown }));
  }
  cancel(id: string): void {
    this.load(id);
    this.db.prepare('UPDATE runs SET cancel=1 WHERE id=?').run(id);
  }
  cancelled(id: string): boolean {
    return this.db.prepare('SELECT cancel FROM runs WHERE id=?').get(id)?.cancel === 1;
  }
  lock(id: string): () => void {
    const dir = this.directory(id);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'owner.lock');
    try { writeFileSync(path, String(process.pid), { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(path, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid lock; inspect owner.lock manually');
      try { process.kill(pid, 0); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
          // Never automatically remove stale locks: two recovering processes could race.
          throw new Error('Stale run lock. Inspect the run, then use unlock --confirm-owner-stopped');
        }
        throw e;
      }
      throw new Error(`Run already owned by process ${pid}`);
    }
    return () => unlinkSync(path);
  }
  unlock(id: string): void {
    this.load(id);
    const path = join(this.directory(id), 'owner.lock');
    const pid = Number(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid owner PID');
    try { process.kill(pid, 0); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(path); return; }
      throw e;
    }
    throw new Error(`Owner ${pid} is still alive; refusing unlock`);
  }
  close(): void { this.db.close(); }
}
