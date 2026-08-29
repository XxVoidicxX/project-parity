import { AlertDispatcher } from './alerts.js';
import { AuditListener } from './audit-listener.js';
import { Ledger, MemoryLedgerAdapter } from './ledger.js';
import { OperationJournal } from './operation-journal.js';
import { Reconciler } from './reconciler.js';
export { AlertDispatcher, DirectMessageAlertStrategy, WebhookAlertStrategy } from './alerts.js';
export { AuditListener } from './audit-listener.js';
export { Ledger, MemoryLedgerAdapter } from './ledger.js';
export { OperationJournal } from './operation-journal.js';
export { Reconciler } from './reconciler.js';
export { attachAutoWrap, AUTO_WRAP_COVERAGE } from './auto-wrap.js';

class PendingOperations {
  constructor(waitMs = 5000) { this.waitMs = waitMs; this.operations = new Set(); }
  async run(operation, intentFactory, recordIntent, operationSucceeded) {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    this.operations.add(pending);
    try {
      const result = await operation();
      const entry = await recordIntent(intentFactory(result), 'track-result');
      await operationSucceeded(entry, 'track-result');
      return result;
    } finally {
      this.operations.delete(pending);
      release();
    }
  }
  async wait() {
    const snapshot = [...this.operations];
    if (!snapshot.length) return;
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(resolve, this.waitMs); timer.unref?.(); });
    await Promise.race([Promise.allSettled(snapshot), timeout]);
    clearTimeout(timer);
  }
}

export function attach(client, options = {}) {
  const ledger = options.ledger ?? new Ledger(options);
  const dispatcher = options.dispatcher ?? new AlertDispatcher(options.strategies);
  const reconciler = options.reconciler ?? new Reconciler({ ledger, clock: options.clock, toleranceMs: options.toleranceMs });
  const journal = options.journal ?? new OperationJournal({ limit: options.journalLimit, clock: options.clock });
  const projectEntry = entry => ({ correlationId: entry.correlationId, actionType: entry.actionType, targetId: entry.targetId, targetType: entry.targetType, guildId: entry.guildId, ...(entry.count === undefined ? {} : { count: entry.count }) });
  const observe = async record => { const stored = journal.record(record); try { await options.onEvent?.(stored); } catch {} return stored; };
  const recordIntent = async (intent, source = 'manual') => { const entry = await ledger.record(intent); await observe({ phase: 'code-intent-recorded', source, ...projectEntry(entry) }); return entry; };
  const cancelIntent = async (entry, source = 'track') => { await ledger.remove(entry.correlationId); await observe({ phase: 'code-operation-failed', source, ...projectEntry(entry), reason: 'operation-rejected' }); };
  const operationSucceeded = async (entry, source) => observe({ phase: 'code-operation-succeeded', source, ...projectEntry(entry) });
  const pending = new PendingOperations(options.pendingWaitMs);
  const listener = new AuditListener({ client, reconciler, dispatcher, botUserId: options.botUserId, clock: options.clock, waitForPending: () => pending.wait(), onEvent: observe });
  listener.start();
  return {
    ledger,
    reconciler,
    dispatcher,
    listener,
    journal,
    intent: intent => recordIntent(intent),
    cancelIntent,
    async track(intent, operation) {
      if (typeof intent === 'function') {
        return pending.run(operation, intent, recordIntent, operationSucceeded);
      }
      const entry = await recordIntent(intent, 'track-before');
      try {
        const result = await operation();
        await operationSucceeded(entry, 'track-before');
        return result;
      } catch (error) {
        await cancelIntent(entry, 'track-before');
        throw error;
      }
    },
    detach: () => listener.stop(),
  };
}
import { SqliteLedgerAdapter } from './sqlite-ledger-adapter.js';
export { SqliteLedgerAdapter } from './sqlite-ledger-adapter.js';
