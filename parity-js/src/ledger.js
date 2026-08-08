import { iso } from './contract.js';
export class MemoryLedgerAdapter { constructor() { this.entries = new Map(); } async insert(entry) { this.entries.set(entry.correlationId, structuredClone(entry)); } async has(correlationId) { return this.entries.has(correlationId); } async all() { return [...this.entries.values()].map(entry => structuredClone(entry)); } async remove(correlationId) { this.entries.delete(correlationId); } }
export class Ledger {
  constructor({ adapter = new MemoryLedgerAdapter(), ttlMs = 120000, clock = () => Date.now(), idFactory = () => crypto.randomUUID() } = {}) { this.adapter = adapter; this.ttlMs = ttlMs; this.clock = clock; this.idFactory = idFactory; }
  async record(intent) {
    const actionType = String(intent.actionType);
    if (/^UNKNOWN_/.test(actionType)) throw new Error('Unknown audit actions cannot be ledgered until they are mapped');
    const timestamp = iso(intent.timestamp ?? this.clock());
    const correlationId = String(intent.correlationId ?? this.idFactory());
    const duplicate = this.adapter.has ? await this.adapter.has(correlationId) : (await this.entries()).some(entry => entry.correlationId === correlationId);
    if (duplicate) throw new Error(`Duplicate correlationId: ${correlationId}`);
    const entry = { actionType, targetId: String(intent.targetId), targetType: String(intent.targetType ?? 'unknown'), guildId: String(intent.guildId), timestamp, correlationId, expiresAt: iso(intent.expiresAt ?? new Date(timestamp).getTime() + this.ttlMs), ...(intent.metadata === undefined ? {} : { metadata: intent.metadata }) };
    await this.adapter.insert(entry); return entry;
  }
  async entries() { return this.adapter.all(); }
  async remove(correlationId) { await this.adapter.remove(correlationId); }
  async purge(now = this.clock(), retentionMs = this.ttlMs) { for (const entry of await this.entries()) if (new Date(entry.expiresAt).getTime() + retentionMs < now) await this.remove(entry.correlationId); }
}

