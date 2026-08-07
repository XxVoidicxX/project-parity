import { AlertDispatcher } from './alerts.js';
import { AuditListener } from './audit-listener.js';
import { Ledger, MemoryLedgerAdapter } from './ledger.js';
import { Reconciler } from './reconciler.js';
export { AlertDispatcher, DirectMessageAlertStrategy, WebhookAlertStrategy } from './alerts.js';
export { AuditListener } from './audit-listener.js';
export { Ledger, MemoryLedgerAdapter } from './ledger.js';
export { Reconciler } from './reconciler.js';
export function attach(client, options = {}) { const ledger = options.ledger ?? new Ledger(options); const dispatcher = options.dispatcher ?? new AlertDispatcher(options.strategies); const reconciler = options.reconciler ?? new Reconciler({ ledger, clock: options.clock, toleranceMs: options.toleranceMs }); const listener = new AuditListener({ client, reconciler, dispatcher, botUserId: options.botUserId, clock: options.clock }); listener.start(); return { ledger, reconciler, dispatcher, listener, intent: intent => ledger.record(intent), async track(intent, operation) { await ledger.record(intent); return operation(); }, detach: () => listener.stop() }; }
import { SqliteLedgerAdapter } from './sqlite-ledger-adapter.js';
export { SqliteLedgerAdapter } from './sqlite-ledger-adapter.js';

