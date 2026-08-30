import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const DEFAULT_SETTINGS = { console: 'off', logLimit: 500 };
const iso = value => new Date(value).toISOString();
const read = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
const write = (path, value) => { const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2)); renameSync(temporary, path); };

export class RuntimeStore {
  constructor({ dir = process.env.PARITY_RUNTIME_DIR ?? join(process.cwd(), '.parity'), clock = () => Date.now() } = {}) {
    this.dir = resolve(dir);
    this.clock = clock;
    this.paths = { settings: join(this.dir, 'settings.json'), status: join(this.dir, 'status.json'), logs: join(this.dir, 'logs.json') };
  }
  ensure() { mkdirSync(this.dir, { recursive: true }); }
  settings() { return { ...DEFAULT_SETTINGS, ...read(this.paths.settings, {}) }; }
  setSettings(updates) {
    const next = { ...this.settings(), ...updates };
    if (!['off', 'drift', 'all'].includes(next.console)) throw new Error('Console mode must be off, drift, or all');
    if (!Number.isInteger(next.logLimit) || next.logLimit < 1 || next.logLimit > 10000) throw new Error('Log limit must be an integer from 1 through 10000');
    this.ensure(); write(this.paths.settings, next); return next;
  }
  status() { return read(this.paths.status, null); }
  logs() { return read(this.paths.logs, []); }
  start(details = {}) {
    this.ensure();
    const previous = this.status();
    const status = { schemaVersion: '1.0', state: 'attached', startedAt: previous?.state === 'attached' ? previous.startedAt : iso(this.clock()), updatedAt: iso(this.clock()), events: previous?.events ?? 0, drifts: previous?.drifts ?? 0, ...details };
    write(this.paths.status, status); return status;
  }
  record(record) {
    this.ensure();
    const settings = this.settings();
    const logs = [...this.logs(), record].slice(-settings.logLimit);
    write(this.paths.logs, logs);
    const previous = this.status() ?? this.start();
    const status = { ...previous, state: 'attached', updatedAt: iso(this.clock()), events: (previous.events ?? 0) + 1, drifts: (previous.drifts ?? 0) + (record.phase === 'discord-drift' ? 1 : 0), lastEvent: { phase: record.phase, recordedAt: record.recordedAt, transport: record.transport ?? null } };
    write(this.paths.status, status);
    if (settings.console === 'all' || settings.console === 'drift' && record.phase === 'discord-drift') console.log(`[parity] ${record.phase}${record.transport ? ` ${record.transport}` : ''}`);
    return record;
  }
  heartbeat() {
    const previous = this.status();
    if (!previous || previous.state !== 'attached') return previous;
    const status = { ...previous, updatedAt: iso(this.clock()) };
    write(this.paths.status, status); return status;
  }
  stop() {
    const previous = this.status() ?? this.start();
    const status = { ...previous, state: 'detached', stoppedAt: iso(this.clock()), updatedAt: iso(this.clock()) };
    write(this.paths.status, status); return status;
  }
  clearLogs() { this.ensure(); write(this.paths.logs, []); }
  reset() { if (existsSync(this.dir)) rmSync(this.dir, { recursive: true, force: true }); }
  health(maxAgeMs = 60000) {
    const status = this.status();
    if (!status) return { ok: false, detail: 'No Parity runtime state exists. Start the bot once first.' };
    if (status.state !== 'attached') return { ok: false, detail: `Parity is ${status.state}.` };
    const age = this.clock() - Date.parse(status.updatedAt);
    if (!Number.isFinite(age) || age > maxAgeMs) return { ok: false, detail: `Parity status is stale by ${Number.isFinite(age) ? Math.floor(age / 1000) : 'an unknown number of'} seconds.` };
    return { ok: true, detail: `Attached and updated ${Math.floor(age / 1000)} seconds ago.` };
  }
}
