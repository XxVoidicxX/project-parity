import { collapsedActions, nearestProjection, stringId } from './contract.js';
export const MAX_AUDIT_COUNT = 10000;
const remediation = ['Immediately rotate the bot token.', 'Inspect running bot instances and deployment credentials.', 'Preserve this report and relevant Discord audit logs for investigation.'];
const time = value => new Date(value).getTime();
export class Reconciler {
  constructor({ ledger, clock = () => Date.now(), toleranceMs = 120000 } = {}) { this.ledger = ledger; this.clock = clock; this.toleranceMs = toleranceMs; this.queue = Promise.resolve(); }
  async reconcile(event) {
    return (await this.reconcileDetailed(event)).report;
  }
  async reconcileDetailed(event) {
    const previous = this.queue;
    let release;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await this.reconcileLocked(event); } finally { release(); }
  }
  async reconcileLocked(event) {
    const parsedCount = Number(event.count ?? 1);
    const countValid = Number.isSafeInteger(parsedCount) && parsedCount >= 1 && parsedCount <= MAX_AUDIT_COUNT;
    const canonical = { ...event, actionType: String(event.actionType), targetId: stringId(event.targetId), targetType: String(event.targetType), guildId: stringId(event.guildId), executorId: stringId(event.executorId), auditEntryId: event.auditEntryId == null ? null : stringId(event.auditEntryId), count: countValid ? parsedCount : Math.min(Math.max(Number.isFinite(parsedCount) ? Math.trunc(parsedCount) : 1, 1), MAX_AUDIT_COUNT) };
    const entries = await this.ledger.entries();
    if (!countValid) return this.drift(canonical, this.nearest(canonical, entries));
    const burst = collapsedActions.has(canonical.actionType) && canonical.count > 1;
    const eligible = entries.filter(entry => entry.guildId === canonical.guildId && entry.actionType === canonical.actionType && entry.targetType === canonical.targetType && time(entry.expiresAt) >= time(canonical.occurredAt) && Math.abs(time(entry.timestamp) - time(canonical.occurredAt)) <= this.toleranceMs);
    if (canonical.actionType === 'MESSAGE_BULK_DELETE') {
      const exact = eligible.filter(entry => entry.targetId === canonical.targetId && entry.count === canonical.count).sort((a, b) => time(a.timestamp) - time(b.timestamp) || a.correlationId.localeCompare(b.correlationId))[0];
      if (exact) { await this.ledger.remove(exact.correlationId); return this.matched([exact]); }
      return this.drift(canonical, this.nearest(canonical, entries));
    }
    if (burst) return this.reconcileBurst(canonical, eligible, entries);
    const exact = eligible.filter(entry => entry.targetId === canonical.targetId).sort((a, b) => time(a.timestamp) - time(b.timestamp) || a.correlationId.localeCompare(b.correlationId))[0];
    if (exact) { await this.ledger.remove(exact.correlationId); return this.matched([exact]); }
    return this.drift(canonical, this.nearest(canonical, entries));
  }
  async reconcileBurst(event, eligible, entries) {
    const selected = [];
    let units = 0;
    for (const entry of eligible.sort((a, b) => time(a.timestamp) - time(b.timestamp) || a.correlationId.localeCompare(b.correlationId))) {
      const entryUnits = entry.count ?? 1;
      if (entryUnits > event.count - units) continue;
      selected.push(entry);
      units += entryUnits;
      if (units === event.count) break;
    }
    for (const entry of selected) await this.ledger.remove(entry.correlationId);
    return units === event.count ? this.matched(selected) : this.drift(event, this.nearest(event, entries.filter(entry => !selected.some(selectedEntry => selectedEntry.correlationId === entry.correlationId))), selected);
  }
  matched(entries) { return { status: 'matched', report: null, matchedCorrelationIds: entries.map(entry => entry.correlationId) }; }
  drift(event, nearest, consumed = []) { return { status: 'drift', report: this.report(event, nearest), matchedCorrelationIds: consumed.map(entry => entry.correlationId) }; }
  nearest(event, entries) {
    const candidates = entries.filter(entry => entry.guildId === event.guildId);
    if (!candidates.length) return null;
    return candidates.sort((a, b) => this.rank(event, b) - this.rank(event, a) || Math.abs(time(a.timestamp) - time(event.occurredAt)) - Math.abs(time(b.timestamp) - time(event.occurredAt)) || a.correlationId.localeCompare(b.correlationId))[0];
  }
  rank(event, entry) { return (entry.actionType === event.actionType ? 4 : 0) + (entry.targetId === event.targetId ? 2 : 0) + (time(entry.expiresAt) >= time(event.occurredAt) ? 1 : 0); }
  report(event, nearest) {
    const state = nearest === null ? 'none' : time(nearest.expiresAt) < time(event.occurredAt) ? 'expired' : 'partial';
    return { schemaVersion: '1.0', kind: 'drift', detectedAt: new Date(this.clock()).toISOString(), event: { actionType: event.actionType, targetId: stringId(event.targetId), targetType: event.targetType, guildId: event.guildId, executorId: event.executorId, auditEntryId: event.auditEntryId ?? null, occurredAt: event.occurredAt, count: event.count ?? 1 }, ledger: { state, nearest: nearestProjection(nearest) }, confidence: state === 'partial' ? 'medium' : 'high', suggestedRemediation: remediation };
  }
}

