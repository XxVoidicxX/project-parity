import { AlertDispatcher, DiscordChannelAlertStrategy } from './alerts.js';
import { AuditListener } from './audit-listener.js';
import { Ledger, MemoryLedgerAdapter } from './ledger.js';
import { OperationJournal } from './operation-journal.js';
import { Reconciler } from './reconciler.js';
import { RuntimeStore } from './runtime-store.js';
import { attachAutoWrap } from './auto-wrap.js';
export { AlertDispatcher, DirectMessageAlertStrategy, DiscordChannelAlertStrategy, WebhookAlertStrategy, buildDriftAlertComponents, buildNoticeComponents, formatDriftAlert } from './alerts.js';
export { AuditListener } from './audit-listener.js';
export { Ledger, MemoryLedgerAdapter } from './ledger.js';
export { OperationJournal } from './operation-journal.js';
export { Reconciler } from './reconciler.js';
export { RuntimeStore } from './runtime-store.js';
export { inspectOnboarding, runOnboardingDoctor } from './doctor.js';
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
  if (options.autoWrap !== undefined && options.autoWrap !== true && options.autoWrap !== false && (typeof options.autoWrap !== 'object' || Array.isArray(options.autoWrap) || options.autoWrap === null)) throw new TypeError('autoWrap must be true, false, or an options object');
  const ledger = options.ledger ?? new Ledger(options);
  const reconciler = options.reconciler ?? new Reconciler({ ledger, clock: options.clock, toleranceMs: options.toleranceMs });
  const journal = options.journal ?? new OperationJournal({ limit: options.journalLimit, clock: options.clock });
  const runtime = options.runtime === false ? null : options.runtime ?? new RuntimeStore({ dir: options.runtimeDir });
  if (runtime && options.console != null) runtime.setSettings({ console: options.console });
  runtime?.start({ botUserId: client?.user?.id == null ? null : String(client.user.id) });
  const heartbeatMs = options.runtimeHeartbeatMs ?? 30000;
  const heartbeat = runtime && Number.isInteger(heartbeatMs) && heartbeatMs > 0 ? setInterval(() => runtime.heartbeat(), heartbeatMs) : null;
  heartbeat?.unref?.();
  const projectEntry = entry => ({ correlationId: entry.correlationId, actionType: entry.actionType, targetId: entry.targetId, targetType: entry.targetType, guildId: entry.guildId, ...(entry.count === undefined ? {} : { count: entry.count }) });
  const observe = async record => { const stored = journal.record(record); runtime?.record(stored); try { await options.onEvent?.(stored); } catch {} return stored; };
  const recordIntent = async (intent, source = 'manual') => { const entry = await ledger.record(intent); await observe({ phase: 'code-intent-recorded', source, ...projectEntry(entry) }); return entry; };
  const cancelIntent = async (entry, source = 'track') => { await ledger.remove(entry.correlationId); await observe({ phase: 'code-operation-failed', source, ...projectEntry(entry), reason: 'operation-rejected' }); };
  const operationSucceeded = async (entry, source) => observe({ phase: 'code-operation-succeeded', source, ...projectEntry(entry) });
  const pending = new PendingOperations(options.pendingWaitMs);
  const track = async (intent, operation) => {
    if (typeof intent === 'function') return pending.run(operation, intent, recordIntent, operationSucceeded);
    const entry = await recordIntent(intent, 'track-before');
    try {
      const result = await operation();
      await operationSucceeded(entry, 'track-before');
      return result;
    } catch (error) {
      await cancelIntent(entry, 'track-before');
      throw error;
    }
  };
  const trackAlertMessage = (channel, payload) => track(
    message => ({ actionType: 'MESSAGE_CREATE', targetId: String(message.id), targetType: 'message', guildId: String(channel.guildId ?? channel.guild?.id ?? 'unknown') }),
    () => channel.send(payload),
  );
  const ownerAlert = options.alertChannelId == null ? null : new DiscordChannelAlertStrategy({ client, channelId: options.alertChannelId, mentionUserId: options.alertUserId, sendMessage: trackAlertMessage });
  const strategies = [...(options.strategies ?? []), ...(ownerAlert ? [ownerAlert] : [])];
  const dispatcher = options.dispatcher ?? new AlertDispatcher(strategies);
  const listener = new AuditListener({ client, reconciler, dispatcher, botUserId: options.botUserId, clock: options.clock, waitForPending: () => pending.wait(), onEvent: observe });
  listener.start();
  const parity = {
    ledger,
    reconciler,
    dispatcher,
    listener,
    journal,
    runtime,
    intent: intent => recordIntent(intent),
    cancelIntent,
    track,
    testOwnerAlert: async () => {
      if (!ownerAlert) throw new Error('Configure alertChannelId before testing owner alerts');
      return ownerAlert.sendNotice('Parity onboarding test passed. This expected message confirms that private owner alerts are working.');
    },
    detach: () => { listener.stop(); if (heartbeat) clearInterval(heartbeat); runtime?.stop(); },
  };
  if (options.autoWrap) {
    const autoWrapOptions = options.autoWrap === true ? {} : options.autoWrap;
    const onUnsupportedCall = autoWrapOptions.onUnsupportedCall;
    attachAutoWrap(client, parity, {
      ...autoWrapOptions,
      onUnsupportedCall: call => {
        const recorded = observe({ phase: 'auto-wrap-unsupported', source: 'auto-wrap', call });
        recorded.catch(() => {});
        try {
          const result = onUnsupportedCall?.(call);
          if (result?.then) result.catch(() => {});
        } catch {}
      },
    });
  }
  return parity;
}
import { SqliteLedgerAdapter } from './sqlite-ledger-adapter.js';
export { SqliteLedgerAdapter } from './sqlite-ledger-adapter.js';
