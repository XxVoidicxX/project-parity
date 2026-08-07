import { iso } from './contract.js';
export class MemoryLedgerAdapter { constructor() { this.entries = new Map(); } async insert(entry) { this.entries.set(entry.correlationId, structuredClone(entry)); } async all() { return [...this.entries.values()].map(entry => structuredClone(entry)); } async remove(correlationId) { this.entries.delete(correlationId); } }
export class Ledger {
  constructor({ adapter = new MemoryLedgerAdapter(), ttlMs = 120000, clock = () => Date.now(), idFactory = () => crypto.randomUUID() } = {}) { this.adapter = adapter; this.ttlMs = ttlMs; this.clock = clock; this.idFactory = idFactory; }
  async record(intent) { const timestamp = iso(intent.timestamp ?? this.clock()); const entry = { actionType: String(intent.actionType), targetId: String(intent.targetId), targetType: String(intent.targetType ?? 'unknown'), guildId: String(intent.guildId), timestamp, correlationId: String(intent.correlationId ?? this.idFactory()), expiresAt: iso(intent.expiresAt ?? new Date(timestamp).getTime() + this.ttlMs), ...(intent.metadata === undefined ? {} : { metadata: intent.metadata }) }; await this.adapter.insert(entry); return entry; }
  async entries() { return this.adapter.all(); }
  async remove(correlationId) { await this.adapter.remove(correlationId); }
  async purge(now = this.clock(), retentionMs = this.ttlMs) { for (const entry of await this.entries()) if (new Date(entry.expiresAt).getTime() + retentionMs < now) await this.remove(entry.correlationId); }
}

