import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { attach } from '../src/index.js';

const clock = () => Date.parse('2026-08-29T12:00:00.000Z');

function createClient(guild) {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  client.guilds = { cache: new Map([[guild.id, guild]]) };
  return client;
}

function createGuild(overrides = {}) {
  return { id: 'guild', roles: {}, channels: {}, members: {}, bans: {}, ...overrides };
}

test('autoWrap false leaves supported managers untouched', async () => {
  class RoleManager { async create() { return { id: 'role' }; } }
  const manager = new RoleManager();
  const guild = createGuild({ roles: manager });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: false });
  await guild.roles.create({ name: 'role' });
  assert.equal(guild.roles, manager);
  assert.deepEqual(await parity.ledger.entries(), []);
  parity.detach();
});

test('autoWrap records channel delete before the REST operation', async () => {
  class GuildChannelManager { async delete(channel) { return { id: channel }; } }
  const guild = createGuild({ channels: new GuildChannelManager() });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: true });
  await guild.channels.delete('channel');
  assert.deepEqual((await parity.ledger.entries()).map(entry => [entry.actionType, entry.targetId, entry.targetType]), [['CHANNEL_DELETE', 'channel', 'channel']]);
  parity.detach();
});

test('autoWrap maps role create edit and delete operations', async () => {
  class RoleManager {
    async create() { return { id: 'created-role' }; }
    async edit(role) { return { id: role }; }
    async delete(role) { return { id: role }; }
  }
  const guild = createGuild({ roles: new RoleManager() });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: true });
  await guild.roles.create({ name: 'role' });
  await guild.roles.edit('edited-role', { name: 'edited' });
  await guild.roles.delete('deleted-role');
  assert.deepEqual((await parity.ledger.entries()).map(entry => [entry.actionType, entry.targetId]), [['ROLE_CREATE', 'created-role'], ['ROLE_UPDATE', 'edited-role'], ['ROLE_DELETE', 'deleted-role']]);
  parity.detach();
});

test('autoWrap maps member kick ban and edit operations', async () => {
  class GuildMemberManager {
    async kick(user) { return user; }
    async ban(user) { return user; }
    async edit(user) { return user; }
  }
  const guild = createGuild({ members: new GuildMemberManager() });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: true });
  await guild.members.kick('kicked-user');
  await guild.members.ban({ id: 'banned-user' });
  await guild.members.edit({ user: { id: 'edited-user' } }, { nick: 'edited' });
  assert.deepEqual((await parity.ledger.entries()).map(entry => [entry.actionType, entry.targetId]), [['MEMBER_KICK', 'kicked-user'], ['MEMBER_BAN_ADD', 'banned-user'], ['MEMBER_UPDATE', 'edited-user']]);
  parity.detach();
});

test('autoWrap maps guild ban creation and removal', async () => {
  class GuildBanManager {
    async create(user) { return user; }
    async remove(user) { return user; }
  }
  const guild = createGuild({ bans: new GuildBanManager() });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: true });
  await guild.bans.create('banned-user');
  await guild.bans.remove({ id: 'unbanned-user' });
  assert.deepEqual((await parity.ledger.entries()).map(entry => [entry.actionType, entry.targetId]), [['MEMBER_BAN_ADD', 'banned-user'], ['MEMBER_BAN_REMOVE', 'unbanned-user']]);
  parity.detach();
});

test('autoWrap does not leave an entry when a generated-ID create rejects', async () => {
  class GuildChannelManager { async create() { throw new Error('Discord rejected create'); } }
  const guild = createGuild({ channels: new GuildChannelManager() });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: true });
  await assert.rejects(guild.channels.create({ name: 'rejected' }), /Discord rejected create/);
  assert.deepEqual(await parity.ledger.entries(), []);
  parity.detach();
});

test('autoWrap preserves operations when an unsupported-call callback fails', async () => {
  class RoleManager { async setPositions() { return 'updated'; } }
  const guild = createGuild({ roles: new RoleManager() });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: { onUnsupportedCall: () => { throw new Error('observer failed'); } } });
  assert.equal(await guild.roles.setPositions([]), 'updated');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(parity.journal.entries().filter(entry => entry.phase === 'auto-wrap-unsupported').length, 1);
  parity.detach();
});
