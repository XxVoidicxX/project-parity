import { iso } from './contract.js';
export class MemoryLedgerAdapter { constructor() { this.entries = new Map(); } async insert(entry) { this.entries.set(entry.correlationId, structuredClone(entry)); } async has(correlationId) { return this.entries.has(correlationId); } async all() { return [...this.entries.values()].map(entry => structuredClone(entry)); } async remove(correlationId) { this.entries.delete(correlationId); } }
export class Ledger {
  constructor({ adapter = new MemoryLedgerAdapter(), ttlMs = 120000, clock = () => Date.now(), idFactory = () => crypto.randomUUID() } = {}) { this.adapter = adapter; this.ttlMs = ttlMs; this.clock = clock; this.idFactory = idFactory; this.writeQueue = Promise.resolve(); }
  async record(intent) { const previous = this.writeQueue; let release; this.writeQueue = new Promise(resolve => { release = resolve; }); await previous; try { return await this.recordLocked(intent); } finally { release(); } }
  async recordLocked(intent) {
    const own = (key, fallback) => { const value = Object.prototype.hasOwnProperty.call(intent, key) ? intent[key] : undefined; return value === undefined ? fallback : value; };
    const actionType = String(own('actionType'));
    if (/^UNKNOWN_/.test(actionType)) throw new Error('Unknown audit actions cannot be ledgered until they are mapped');
    const timestamp = iso(own('timestamp', this.clock()));
    const correlationId = String(own('correlationId', this.idFactory()));
    const duplicate = this.adapter.has ? await this.adapter.has(correlationId) : (await this.entries()).some(entry => entry.correlationId === correlationId);
    if (duplicate) throw new Error(`Duplicate correlationId: ${correlationId}`);
    const entry = { actionType, targetId: String(own('targetId')), targetType: String(own('targetType', 'unknown')), guildId: String(own('guildId')), timestamp, correlationId, expiresAt: iso(own('expiresAt', new Date(timestamp).getTime() + this.ttlMs)), ...(Object.prototype.hasOwnProperty.call(intent, 'metadata') ? { metadata: structuredClone(intent.metadata) } : {}) };
    await this.adapter.insert(entry); return entry;
  }
  async entries() { return this.adapter.all(); }
  async remove(correlationId) { await this.adapter.remove(correlationId); }
  async purge(now = this.clock(), retentionMs = this.ttlMs) { for (const entry of await this.entries()) if (new Date(entry.expiresAt).getTime() + retentionMs < now) await this.remove(entry.correlationId); }
}

