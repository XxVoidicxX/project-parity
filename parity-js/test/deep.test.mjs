import assert from 'node:assert/strict';
import test from 'node:test';
import { Ledger, Reconciler } from '../src/index.js';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const clock = () => NOW;
const intent = (overrides = {}) => ({ actionType: 'CHANNEL_CREATE', targetId: 'target', targetType: 'channel', guildId: 'guild', correlationId: 'intent', ...overrides });
const event = (overrides = {}) => ({ actionType: 'CHANNEL_CREATE', targetId: 'target', targetType: 'channel', guildId: 'guild', executorId: 'bot', occurredAt: new Date(NOW).toISOString(), count: 1, ...overrides });

function seeded(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

test('timing matrix treats the tolerance edge as inclusive and classifies adjacent misses', async () => {
  for (const [offset, expected] of [[-120000, null], [-119999, null], [119999, null], [120000, null], [-120001, 'partial'], [120001, 'partial'], [-600000, 'partial']]) {
    const ledger = new Ledger({ clock });
    await ledger.record(intent({ correlationId: `timing-${offset}`, timestamp: NOW + offset, expiresAt: NOW + 999999 }));
    const report = await new Reconciler({ ledger, clock }).reconcile(event());
    assert.equal(report?.ledger.state ?? null, expected, `offset ${offset}`);
  }
  const expired = new Ledger({ clock });
  await expired.record(intent({ correlationId: 'expired', expiresAt: NOW - 1 }));
  assert.equal((await new Reconciler({ ledger: expired, clock }).reconcile(event())).ledger.state, 'expired');
});

test('seeded randomized intents preserve exact matches, report rogue actions, and purge bounded ledgers', async () => {
  const random = seeded(0xdecafbad);
  const ledger = new Ledger({ clock, ttlMs: 1000 });
  const reconciler = new Reconciler({ ledger, clock, toleranceMs: 120000 });
  const actions = ['CHANNEL_CREATE', 'ROLE_UPDATE', 'WEBHOOK_CREATE', 'THREAD_DELETE'];
  const exactEvents = [];
  const rogueEvents = [];
  for (let index = 0; index < 400; index++) {
    const actionType = actions[Math.floor(random() * actions.length)];
    const guildId = `guild-${Math.floor(random() * 4)}`;
    const targetId = `target-${index}`;
    const offset = Math.floor(random() * 240001) - 120000;
    await ledger.record(intent({ actionType, guildId, targetId, correlationId: `fuzz-${index}`, timestamp: NOW + offset, expiresAt: NOW + 500000 }));
    exactEvents.push(event({ actionType, guildId, targetId, occurredAt: new Date(NOW).toISOString() }));
    rogueEvents.push(event({ actionType, guildId, targetId: `rogue-${index}`, occurredAt: new Date(NOW).toISOString() }));
  }
  const exact = await Promise.all(exactEvents.map(item => reconciler.reconcile(item)));
  assert.ok(exact.every(report => report === null), 'no exact and timely intent drifted');
  const rogue = await Promise.all(rogueEvents.map(item => reconciler.reconcile(item)));
  assert.ok(rogue.every(report => report?.kind === 'drift'), 'every unmatched self-action drifted');
  await ledger.purge(NOW + 502001, 1000);
  assert.equal((await ledger.entries()).length, 0, 'purge bounds retained entries');
});

test('collapsed bursts never under-report and 10000-entry burst leaves no entries', async () => {
  const ledger = new Ledger({ clock });
  for (let index = 0; index < 10000; index++) await ledger.record(intent({ actionType: 'MESSAGE_DELETE', targetType: 'message', targetId: `message-${index}`, correlationId: `scale-${index}` }));
  const reconciler = new Reconciler({ ledger, clock });
  assert.equal(await reconciler.reconcile(event({ actionType: 'MESSAGE_DELETE', targetType: 'message', targetId: 'message-0', count: 10000 })), null);
  assert.equal((await ledger.entries()).length, 0);
  await ledger.record(intent({ actionType: 'MESSAGE_DELETE', targetType: 'message', correlationId: 'one' }));
  const report = await reconciler.reconcile(event({ actionType: 'MESSAGE_DELETE', targetType: 'message', count: 2 }));
  assert.equal(report.event.count, 2);
  assert.equal((await ledger.entries()).length, 0, 'selected burst intent is consumed before reporting deficit');
});

test('concurrent reconciliation serializes 1000 exact entries without leaks', async () => {
  const ledger = new Ledger({ clock });
  await Promise.all([...Array(1000)].map((_, index) => ledger.record(intent({ targetId: String(index), correlationId: `concurrent-${index}` }))));
  const reconciler = new Reconciler({ ledger, clock });
  const reports = await Promise.all([...Array(1000)].map((_, index) => reconciler.reconcile(event({ targetId: String(index) }))));
  assert.ok(reports.every(report => report === null));
  assert.equal((await ledger.entries()).length, 0);
});
test('memory ledger purges 50000 expired entries within five seconds', async () => {
  const ledger = new Ledger({ clock });
  await Promise.all([...Array(50000)].map((_, index) => ledger.record(intent({ correlationId: `purge-${index}`, expiresAt: NOW - 1 }))));
  const started = performance.now();
  await ledger.purge(NOW + 120001);
  assert.ok(performance.now() - started < 5000);
  assert.equal((await ledger.entries()).length, 0);
});
