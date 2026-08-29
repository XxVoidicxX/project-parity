import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { attach, attachAutoWrap, AuditListener, Ledger, MemoryLedgerAdapter, Reconciler } from '../src/index.js';
const now = Date.parse('2026-08-07T12:00:00.000Z');
const clock = () => now;
const intent = (overrides = {}) => ({ actionType: 'CHANNEL_CREATE', targetId: 'target', targetType: 'channel', guildId: 'guild', correlationId: 'intent-1', ...overrides });
const event = (overrides = {}) => ({ actionType: 'CHANNEL_CREATE', targetId: 'target', targetType: 'channel', guildId: 'guild', executorId: 'bot', auditEntryId: 'audit-1', occurredAt: new Date(now).toISOString(), count: 1, ...overrides });

test('ledger writes canonical entry and purges only beyond retention', async () => { const ledger = new Ledger({ clock, idFactory: () => 'generated' }); const entry = await ledger.record(intent({ correlationId: undefined })); assert.equal(entry.correlationId, 'generated'); assert.equal(entry.expiresAt, '2026-08-07T12:02:00.000Z'); await ledger.purge(now + 240001); assert.equal((await ledger.entries()).length, 0); });
test('ledger retains at the purge boundary and rejects duplicate correlation IDs', async () => { const ledger = new Ledger({ clock }); await ledger.record(intent({ expiresAt: now })); await ledger.purge(now + 120000); assert.equal((await ledger.entries()).length, 1); await assert.rejects(ledger.record(intent()), /Duplicate correlationId/); });
test('reconciler consumes exact entries at inclusive timing edge', async () => { const ledger = new Ledger({ clock }); await ledger.record(intent({ timestamp: now - 120000 })); const report = await new Reconciler({ ledger, clock }).reconcile(event()); assert.equal(report, null); assert.equal((await ledger.entries()).length, 0); });
test('reconciler reports deterministic partial and expired near misses', async () => { const ledger = new Ledger({ clock }); await ledger.record(intent({ targetId: 'other' })); let report = await new Reconciler({ ledger, clock }).reconcile(event()); assert.equal(report.ledger.state, 'partial'); assert.equal(report.confidence, 'medium'); const oldLedger = new Ledger({ clock }); await oldLedger.record(intent({ targetId: 'other', expiresAt: now - 1 })); report = await new Reconciler({ ledger: oldLedger, clock }).reconcile(event()); assert.equal(report.ledger.state, 'expired'); });
test('collapsed burst consumes action intents regardless of individual targets', async () => { const ledger = new Ledger({ clock }); for (let index = 0; index < 3; index++) await ledger.record(intent({ actionType: 'MEMBER_MOVE', targetId: `member-${index}`, correlationId: `move-${index}` })); const reconciler = new Reconciler({ ledger, clock }); assert.equal(await reconciler.reconcile(event({ actionType: 'MEMBER_MOVE', targetId: 'member-0', count: 3 })), null); assert.equal((await ledger.entries()).length, 0); });
test('under-ledgered collapsed burst reports drift', async () => { const ledger = new Ledger({ clock }); await ledger.record(intent({ actionType: 'MESSAGE_DELETE', targetId: 'x' })); const report = await new Reconciler({ ledger, clock }).reconcile(event({ actionType: 'MESSAGE_DELETE', count: 2 })); assert.equal(report.kind, 'drift'); assert.equal(report.event.count, 2); });
test('all representative coverage actions reconcile exactly', async () => { const actions = ['GUILD_UPDATE','CHANNEL_DELETE','CHANNEL_OVERWRITE_UPDATE','MEMBER_KICK','MEMBER_BAN_ADD','ROLE_UPDATE','INVITE_DELETE','WEBHOOK_CREATE','EMOJI_DELETE','STICKER_UPDATE','INTEGRATION_DELETE','STAGE_INSTANCE_CREATE','GUILD_SCHEDULED_EVENT_UPDATE','THREAD_DELETE','APPLICATION_COMMAND_PERMISSION_UPDATE','AUTO_MODERATION_RULE_CREATE','AUTO_MODERATION_QUARANTINE_USER','ONBOARDING_UPDATE','VOICE_CHANNEL_STATUS_CREATE','SOUNDBOARD_SOUND_CREATE','MESSAGE_PIN']; for (const actionType of actions) { const ledger = new Ledger({ clock }); await ledger.record(intent({ actionType, correlationId: actionType })); assert.equal(await new Reconciler({ ledger, clock }).reconcile(event({ actionType })), null, actionType); } });

test('bulk message delete requires one exact counted intent', async () => {
  let ledger = new Ledger({ clock });
  await ledger.record(intent({ actionType: 'MESSAGE_BULK_DELETE', targetId: 'channel', targetType: 'channel', count: 3 }));
  assert.equal(await new Reconciler({ ledger, clock }).reconcile(event({ actionType: 'MESSAGE_BULK_DELETE', targetId: 'channel', targetType: 'channel', count: 3 })), null);
  ledger = new Ledger({ clock });
  await ledger.record(intent({ actionType: 'MESSAGE_BULK_DELETE', targetId: 'channel', targetType: 'channel', count: 2 }));
  const report = await new Reconciler({ ledger, clock }).reconcile(event({ actionType: 'MESSAGE_BULK_DELETE', targetId: 'channel', targetType: 'channel', count: 3 }));
  assert.equal(report.ledger.state, 'partial');
  assert.equal((await ledger.entries()).length, 1);
  ledger = new Ledger({ clock });
  await ledger.record(intent({ actionType: 'MESSAGE_BULK_DELETE', targetId: 'channel', targetType: 'channel' }));
  assert.equal((await new Reconciler({ ledger, clock }).reconcile(event({ actionType: 'MESSAGE_BULK_DELETE', targetId: 'channel', targetType: 'channel', count: 1 }))).kind, 'drift');
  await assert.rejects(ledger.record(intent({ correlationId: 'bad-count', count: 0 })), /Intent count/);
});
test('mocked gateway detects rogue audit action and self message action', async () => { const client = new EventEmitter(); client.user = { id: 'bot' }; const reports = []; const parity = attach(client, { clock, strategies: [{ send: async report => reports.push(report) }] }); await parity.intent(intent()); client.emit('guildAuditLogEntryCreate', { id: 'audit-ok', action: 10, targetId: 'target', targetType: 'channel', executorId: 'bot', createdTimestamp: now }, { id: 'guild' }); await new Promise(resolve => setImmediate(resolve)); client.emit('guildAuditLogEntryCreate', { id: 'audit-rogue', action: 10, targetId: 'rogue', targetType: 'channel', executorId: 'bot', createdTimestamp: now }, { id: 'guild' }); client.emit('messageCreate', { id: 'message-rogue', guildId: 'guild', author: { id: 'bot' }, createdTimestamp: now }); await new Promise(resolve => setImmediate(resolve)); assert.equal(reports.length, 2); assert.equal(reports[0].event.targetId, 'rogue'); assert.equal(reports[1].event.actionType, 'MESSAGE_CREATE'); parity.detach(); });
test('track removes a pre-call intent when the operation fails and can derive generated target IDs', async () => {
  const client = new EventEmitter();
  const parity = attach(client, { clock });
  await assert.rejects(parity.track(intent(), async () => { throw new Error('REST rejected'); }), /REST rejected/);
  assert.equal((await parity.ledger.entries()).length, 0);
  const result = await parity.track(resource => intent({ targetId: resource.id, correlationId: 'generated-target' }), async () => ({ id: 'discord-id' }));
  assert.equal(result.id, 'discord-id');
  assert.equal((await parity.ledger.entries())[0].targetId, 'discord-id');
  parity.detach();
});
test('result-derived track holds gateway reconciliation until the generated ID is ledgered', async () => {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  const reports = [];
  const parity = attach(client, { clock, strategies: [{ send: async report => reports.push(report) }] });
  let finishOperation;
  const operationGate = new Promise(resolve => { finishOperation = resolve; });
  const tracked = parity.track(
    message => ({ actionType: 'MESSAGE_CREATE', targetId: message.id, targetType: 'message', guildId: 'guild' }),
    async () => { await operationGate; return { id: 'generated-message' }; },
  );
  client.emit('messageCreate', { id: 'generated-message', guildId: 'guild', author: { id: 'bot' }, createdTimestamp: now });
  finishOperation();
  await tracked;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports, []);
  assert.deepEqual(await parity.ledger.entries(), []);
  parity.detach();
});
test('auto-wrap records real create IDs, records edits before the call, and cleans up rejected edits', async () => {
  class RoleManager {
    async create() { return { id: 'created-role' }; }
    async edit(role) { if (role.id === 'rejected-role') throw new Error('REST rejected'); return role; }
    async setPositions() { return 'positions-updated'; }
  }
  const guild = { id: 'guild', roles: new RoleManager(), channels: {}, members: {}, bans: {} };
  const originalRoles = guild.roles;
  const client = new EventEmitter();
  client.guilds = { cache: new Map([['guild', guild]]) };
  const parity = attach(client, { clock });
  const unsupported = [];
  attachAutoWrap(client, parity, { onUnsupportedCall: call => unsupported.push(call) });
  await guild.roles.create({ name: 'created' });
  await guild.roles.edit({ id: 'edited-role' }, { name: 'edited' });
  await assert.rejects(guild.roles.edit({ id: 'rejected-role' }, { name: 'rejected' }), /REST rejected/);
  assert.equal(await guild.roles.setPositions([]), 'positions-updated');
  const entries = await parity.ledger.entries();
  assert.deepEqual(entries.map(entry => [entry.actionType, entry.targetId]), [
    ['ROLE_CREATE', 'created-role'],
    ['ROLE_UPDATE', 'edited-role'],
  ]);
  const coverage = parity.getAutoWrapCoverage();
  assert.ok(coverage.wrapped.some(item => item.managerClass === 'RoleManager' && item.slot === 'roles'));
  assert.ok(coverage.unsupportedManagers.some(item => item.slot === 'channels'));
  assert.deepEqual(coverage.unsupportedCalls.map(item => [item.managerClass, item.method]), [['RoleManager', 'setPositions']]);
  assert.equal(unsupported.length, 1);
  assert.equal(client.listenerCount('guildCreate'), 1);
  parity.detach();
  assert.equal(client.listenerCount('guildCreate'), 0);
  assert.equal(guild.roles, originalRoles);
  attachAutoWrap(client, parity);
  assert.equal(client.listenerCount('guildCreate'), 1);
  parity.detach();
});
test('normalizes live discord.js channel audit action and target fields', () => { const listener = new AuditListener({ botUserId: () => 'bot' }); for (const [action, expected] of [[10, 'CHANNEL_CREATE'], [11, 'CHANNEL_UPDATE'], [12, 'CHANNEL_DELETE']]) { const normalized = listener.normalizeAudit({ id: `audit-${action}`, action, actionType: action === 10 ? 'Create' : action === 11 ? 'Update' : 'Delete', targetId: 'channel', targetType: 'Channel', executorId: 'bot', createdTimestamp: now }, { id: 'guild' }); assert.equal(normalized.actionType, expected); assert.equal(normalized.targetType, 'channel'); } });
test('500 concurrent exact audit entries leave no ledger memory', async () => { const ledger = new Ledger({ clock }); const reconciler = new Reconciler({ ledger, clock }); await Promise.all([...Array(500)].map((_, index) => ledger.record(intent({ targetId: String(index), correlationId: `load-${index}` })))); const results = await Promise.all([...Array(500)].map((_, index) => reconciler.reconcile(event({ targetId: String(index), auditEntryId: `audit-${index}` })))); assert.ok(results.every(result => result === null)); assert.equal((await ledger.entries()).length, 0); });

test('sqlite adapter persists ledger entries through its adapter contract', async () => { const { SqliteLedgerAdapter } = await import('../src/index.js'); const adapter = new SqliteLedgerAdapter(); const ledger = new Ledger({ adapter, clock }); await ledger.record(intent()); assert.equal((await ledger.entries())[0].correlationId, 'intent-1'); await ledger.remove('intent-1'); assert.equal((await ledger.entries()).length, 0); adapter.close(); });
test('adversarial timing, aliases, target types, collisions, and poisoned intents have explicit outcomes', async () => {
  let ledger = new Ledger({ clock }); await ledger.record(intent({ timestamp: now - 120001, expiresAt: now + 1 })); let report = await new Reconciler({ ledger, clock }).reconcile(event()); assert.equal(report.ledger.state, 'partial', 'just outside tolerance is drift');
  ledger = new Ledger({ clock }); await assert.rejects(ledger.record(intent({ actionType: 'UNKNOWN_999' })), /Unknown audit actions/); report = await new Reconciler({ ledger, clock }).reconcile(event({ actionType: 'UNKNOWN_999' })); assert.equal(report.ledger.state, 'none', 'unknown alias is never accepted');
  ledger = new Ledger({ clock }); await ledger.record(intent({ targetType: 'role' })); report = await new Reconciler({ ledger, clock }).reconcile(event()); assert.equal(report.kind, 'drift', 'same ID with different target type is drift');
  ledger = new Ledger({ clock }); await ledger.record(intent({ expiresAt: now - 1 })); report = await new Reconciler({ ledger, clock }).reconcile(event()); assert.equal(report.ledger.state, 'expired', 'expired intent cannot authorize late audit event');
  ledger = new Ledger({ clock }); await ledger.record(intent({ correlationId: 'collision' })); await assert.rejects(ledger.record(intent({ correlationId: 'collision', targetId: 'other' })), /Duplicate correlationId/);
  ledger = new Ledger({ clock }); await ledger.record(intent({ targetId: 'poisoned' })); assert.equal(await new Reconciler({ ledger, clock }).reconcile(event({ targetId: 'poisoned' })), null, 'a writer with ledger access remains in the trusted boundary');
});
test('hardening cases preserve reconciliation and ledger invariants', async () => {
  const listener = new AuditListener({ botUserId: () => 'bot', clock });
  for (const action of [26, 27]) { const normalized = listener.normalizeAudit({ action, actionType: action === 26 ? 'Update' : 'Delete', targetId: 'member', targetType: 'Member', extra: { channel: { id: 'voice' } }, guildId: 'guild', executorId: 'bot', createdTimestamp: now }); assert.deepEqual([normalized.actionType, normalized.targetId, normalized.targetType], action === 26 ? ['MEMBER_MOVE', 'voice', 'channel'] : ['MEMBER_DISCONNECT', 'guild', 'guild']); }
  let ledger = new Ledger({ clock }); await ledger.record(intent({ actionType: 'MEMBER_MOVE', targetId: 'voice', correlationId: 'voice' })); assert.equal(await new Reconciler({ ledger, clock }).reconcile(listener.normalizeAudit({ action: 26, targetId: 'member', targetType: 'Member', extra: { channel: { id: 'voice' } }, guildId: 'guild', executorId: 'bot', createdTimestamp: now })), null);
  for (const count of [0, -1, 999999]) { ledger = new Ledger({ clock }); await ledger.record(intent({ actionType: 'MESSAGE_DELETE', targetType: 'message', correlationId: `count-${count}` })); const report = await new Reconciler({ ledger, clock }).reconcile(event({ actionType: 'MESSAGE_DELETE', targetType: 'message', count })); assert.equal(report.kind, 'drift'); assert.equal((await ledger.entries()).length, 1); }
  ledger = new Ledger({ clock }); await ledger.record(intent({ actionType: 'MESSAGE_DELETE', targetType: 'message', targetId: 'a', correlationId: 'burst-a' })); await ledger.record(intent({ actionType: 'MESSAGE_DELETE', targetType: 'message', targetId: 'b', correlationId: 'burst-b' })); assert.equal(await new Reconciler({ ledger, clock }).reconcile(event({ actionType: 'MESSAGE_DELETE', targetType: 'message', targetId: 'unrelated', count: 2 })), null);
  ledger = new Ledger({ clock }); await ledger.record(intent({ expiresAt: now - 1, correlationId: 'skew' })); let report = await new Reconciler({ ledger, clock: () => now - 999999 }).reconcile(event()); assert.equal(report.ledger.state, 'expired'); assert.equal((await ledger.entries()).length, 1);
  ledger = new Ledger({ clock }); await ledger.record(intent({ correlationId: 'malicious', timestamp: now - 1 })); await ledger.record(intent({ correlationId: 'legitimate', timestamp: now })); assert.equal(await new Reconciler({ ledger, clock }).reconcile(event()), null); assert.deepEqual((await ledger.entries()).map(entry => entry.correlationId), ['legitimate']); await ledger.purge(now + 240001); assert.equal((await ledger.entries()).length, 0);
  ledger = new Ledger({ clock }); await ledger.record(intent({ guildId: '1234', correlationId: 'numeric-guild' })); assert.equal(await new Reconciler({ ledger, clock }).reconcile(event({ guildId: 1234 })), null);
  ledger = new Ledger({ clock }); const poisoned = JSON.parse('{"actionType":"CHANNEL_CREATE","targetId":"target","targetType":"channel","guildId":"guild","correlationId":"poison","__proto__":{"polluted":true},"constructor":"bad"}'); await ledger.record(poisoned); assert.deepEqual(Object.keys((await ledger.entries())[0]).sort(), ['actionType', 'correlationId', 'expiresAt', 'guildId', 'targetId', 'targetType', 'timestamp']);
  const reports = []; const dmListener = new AuditListener({ reconciler: new Reconciler({ ledger: new Ledger({ clock }), clock }), dispatcher: { dispatch: async report => reports.push(report) }, botUserId: () => 'bot', clock }); assert.equal(await dmListener.handleMessage({ id: 'dm', author: { id: 'bot' }, createdTimestamp: now }), null); assert.deepEqual(reports, []);
  ledger = new Ledger({ clock }); const results = await Promise.allSettled([...Array(100)].map(() => ledger.record(intent({ correlationId: 'same-id' })))); assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal((await ledger.entries()).length, 1);
});
