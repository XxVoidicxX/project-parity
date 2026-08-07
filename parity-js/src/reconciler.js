import { collapsedActions, nearestProjection, stringId } from './contract.js';
const remediation = ['Immediately rotate the bot token.', 'Inspect running bot instances and deployment credentials.', 'Preserve this report and relevant Discord audit logs for investigation.'];
const time = value => new Date(value).getTime();
export class Reconciler {
  constructor({ ledger, clock = () => Date.now(), toleranceMs = 120000 } = {}) { this.ledger = ledger; this.clock = clock; this.toleranceMs = toleranceMs; }
  async reconcile(event) {
    const entries = await this.ledger.entries();
    const burst = collapsedActions.has(event.actionType) && event.count > 1;
    const eligible = entries.filter(entry => entry.guildId === event.guildId && entry.actionType === event.actionType && Math.abs(time(entry.timestamp) - time(event.occurredAt)) <= this.toleranceMs);
    if (burst) return this.reconcileBurst(event, eligible, entries);
    const exact = eligible.filter(entry => entry.targetId === event.targetId).sort((a, b) => time(a.timestamp) - time(b.timestamp) || a.correlationId.localeCompare(b.correlationId))[0];
    if (exact) { await this.ledger.remove(exact.correlationId); return null; }
    return this.report(event, this.nearest(event, entries));
  }
  async reconcileBurst(event, eligible, entries) {
    const selected = eligible.sort((a, b) => time(a.timestamp) - time(b.timestamp) || a.correlationId.localeCompare(b.correlationId)).slice(0, event.count);
    for (const entry of selected) await this.ledger.remove(entry.correlationId);
    return selected.length >= event.count ? null : this.report(event, this.nearest(event, entries.filter(entry => !selected.some(selectedEntry => selectedEntry.correlationId === entry.correlationId))));
  }
  nearest(event, entries) {
    const candidates = entries.filter(entry => entry.guildId === event.guildId);
    if (!candidates.length) return null;
    return candidates.sort((a, b) => this.rank(event, b) - this.rank(event, a) || Math.abs(time(a.timestamp) - time(event.occurredAt)) - Math.abs(time(b.timestamp) - time(event.occurredAt)) || a.correlationId.localeCompare(b.correlationId))[0];
  }
  rank(event, entry) { return (entry.actionType === event.actionType ? 4 : 0) + (entry.targetId === event.targetId ? 2 : 0) + (time(entry.expiresAt) >= this.clock() ? 1 : 0); }
  report(event, nearest) {
    const state = nearest === null ? 'none' : time(nearest.expiresAt) < this.clock() ? 'expired' : 'partial';
    return { schemaVersion: '1.0', kind: 'drift', detectedAt: new Date(this.clock()).toISOString(), event: { actionType: event.actionType, targetId: stringId(event.targetId), targetType: event.targetType, guildId: event.guildId, executorId: event.executorId, auditEntryId: event.auditEntryId ?? null, occurredAt: event.occurredAt, count: event.count ?? 1 }, ledger: { state, nearest: nearestProjection(nearest) }, confidence: state === 'partial' ? 'medium' : 'high', suggestedRemediation: remediation };
  }
}

