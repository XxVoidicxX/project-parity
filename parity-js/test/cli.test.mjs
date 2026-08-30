import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import { RuntimeStore } from '../src/runtime-store.js';
import { attach } from '../src/index.js';

const makeStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-cli-'));
  let now = 1000;
  return { dir, store: new RuntimeStore({ dir, clock: () => now }), setNow: value => { now = value; } };
};

test('runtime store tracks lifecycle state, bounded logs, and health', () => {
  const { dir, store, setNow } = makeStore();
  try {
    store.setSettings({ console: 'off', logLimit: 2 });
    store.start({ botUserId: 'bot' });
    store.record({ phase: 'code-intent-recorded', recordedAt: new Date(1000).toISOString() });
    store.record({ phase: 'discord-drift', recordedAt: new Date(1000).toISOString(), transport: 'audit' });
    store.record({ phase: 'discord-matched', recordedAt: new Date(1000).toISOString(), transport: 'message' });
    assert.equal(store.status().events, 3);
    assert.equal(store.status().drifts, 1);
    assert.deepEqual(store.logs().map(record => record.phase), ['discord-drift', 'discord-matched']);
    assert.equal(store.health().ok, true);
    setNow(2000); store.heartbeat();
    assert.equal(store.status().updatedAt, new Date(2000).toISOString());
    setNow(62001);
    assert.equal(store.health().ok, false);
    store.stop();
    assert.equal(store.status().state, 'detached');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI settings, logs, and check provide operator output without console noise', () => {
  const { dir, store } = makeStore();
  const output = []; const errors = [];
  try {
    assert.equal(runCli(['init'], { store, out: value => output.push(value), error: value => errors.push(value) }), 0);
    assert.equal(runCli(['settings', 'console', 'drift'], { store, out: value => output.push(value), error: value => errors.push(value) }), 0);
    assert.equal(runCli(['settings', 'console', 'off'], { store, out: value => output.push(value), error: value => errors.push(value) }), 0);
    store.start(); store.record({ phase: 'discord-drift', recordedAt: new Date(1000).toISOString(), transport: 'audit' });
    assert.equal(runCli(['logs', '--drift', '--json'], { store, out: value => output.push(value), error: value => errors.push(value) }), 0);
    assert.match(output.at(-1), /discord-drift/);
    assert.equal(runCli(['check', '--max-age', '60'], { store, out: value => output.push(value), error: value => errors.push(value) }), 0);
    assert.deepEqual(errors, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('attach writes lifecycle records to its configured runtime store', async () => {
  const { dir, store } = makeStore();
  try {
    const client = new EventEmitter(); client.user = { id: 'bot' };
    const parity = attach(client, { runtime: store, runtimeHeartbeatMs: 0 });
    await parity.intent({ actionType: 'CHANNEL_UPDATE', targetId: 'channel', targetType: 'channel', guildId: 'guild' });
    assert.equal(store.status().state, 'attached');
    assert.equal(store.logs().at(-1).phase, 'code-intent-recorded');
    parity.detach();
    assert.equal(store.status().state, 'detached');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
