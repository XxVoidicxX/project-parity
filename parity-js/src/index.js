import { AlertDispatcher } from './alerts.js';
import { AuditListener } from './audit-listener.js';
import { Ledger, MemoryLedgerAdapter } from './ledger.js';
import { Reconciler } from './reconciler.js';
export { AlertDispatcher, DirectMessageAlertStrategy, WebhookAlertStrategy } from './alerts.js';
export { AuditListener } from './audit-listener.js';
export { Ledger, MemoryLedgerAdapter } from './ledger.js';
export { Reconciler } from './reconciler.js';
export { attachAutoWrap, AUTO_WRAP_COVERAGE } from './auto-wrap.js';

class PendingOperations {
  constructor(waitMs = 5000) { this.waitMs = waitMs; this.operations = new Set(); }
  async run(operation, intentFactory, ledger) {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    this.operations.add(pending);
    try {
      const result = await operation();
      await ledger.record(intentFactory(result));
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
  const pending = new PendingOperations(options.pendingWaitMs);
  const listener = new AuditListener({ client, reconciler, dispatcher, botUserId: options.botUserId, clock: options.clock, waitForPending: () => pending.wait() });
  listener.start();
  return {
    ledger,
    reconciler,
    dispatcher,
    listener,
    intent: intent => ledger.record(intent),
    async track(intent, operation) {
      if (typeof intent === 'function') {
        return pending.run(operation, intent, ledger);
      }
      const entry = await ledger.record(intent);
      try {
        return await operation();
      } catch (error) {
        await ledger.remove(entry.correlationId);
        throw error;
      }
    },
    detach: () => listener.stop(),
  };
}
import { SqliteLedgerAdapter } from './sqlite-ledger-adapter.js';
export { SqliteLedgerAdapter } from './sqlite-ledger-adapter.js';
