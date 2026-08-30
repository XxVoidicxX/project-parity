import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectOnboarding, runOnboardingDoctor } from '../src/index.js';

class Permissions {
  constructor(names) { this.names = new Set(names); }
  has(name) { return this.names.has(name); }
}

function developerBot({ audit = true, send = true, publicChannel = false, ownerVisible = true } = {}) {
  const bot = { id: 'bot', permissions: new Permissions([...(audit ? ['ViewAuditLog'] : [])]) };
  const owner = { id: 'owner' };
  const everyone = { id: 'everyone' };
  const channel = {
    isTextBased: () => true,
    permissionsFor(subject) {
      if (subject === bot) return new Permissions(['ViewChannel', ...(send ? ['SendMessages'] : [])]);
      if (subject === everyone) return new Permissions(publicChannel ? ['ViewChannel'] : []);
      if (subject === owner) return new Permissions(ownerVisible ? ['ViewChannel'] : []);
      return new Permissions([]);
    },
  };
  const guild = {
    id: 'guild',
    roles: { everyone },
    members: { fetchMe: async () => bot, fetch: async id => id === 'owner' ? owner : bot },
  };
  return { user: { id: 'bot' }, guilds: { fetch: async () => guild }, channels: { fetch: async () => channel } };
}

test('doctor approves a private, alert-capable developer bot', async () => {
  const result = await inspectOnboarding({ client: developerBot(), guildId: 'guild', alertChannelId: 'alerts', alertUserId: 'owner' });
  assert.equal(result.ok, true);
  assert.ok(result.checks.every(check => check.pass));
});

test('doctor rejects a public alert channel and a bot without send permission', async () => {
  let result = await inspectOnboarding({ client: developerBot({ publicChannel: true }), guildId: 'guild', alertChannelId: 'alerts' });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(check => check.name === 'Alert channel privacy').pass, false);
  result = await inspectOnboarding({ client: developerBot({ send: false }), guildId: 'guild', alertChannelId: 'alerts' });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(check => check.name === 'Alert channel permissions').pass, false);
});

test('doctor confirms a tracked test alert from a healthy developer bot', async () => {
  const parity = { testOwnerAlert: async () => ({ id: 'test-message' }), journal: { entries: () => [{ phase: 'discord-matched', transport: 'message', event: { targetId: 'test-message' } }] } };
  const result = await runOnboardingDoctor({ client: developerBot(), parity, guildId: 'guild', alertChannelId: 'alerts', sendTest: true });
  assert.equal(result.ok, true);
  assert.equal(result.checks.find(check => check.name === 'Tracked test alert').pass, true);
});
