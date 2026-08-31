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
  return { id: 'guild', roles: {}, channels: {}, members: {}, bans: {}, emojis: {}, stickers: {}, invites: {}, scheduledEvents: {}, autoModerationRules: {}, ...overrides };
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

test('autoWrap maps emoji sticker invite scheduled-event and AutoMod managers', async () => {
  class GuildEmojiManager { async create() { return { id: 'emoji-created' }; } async edit(emoji) { return { id: emoji }; } async delete() {} }
  class GuildStickerManager { async create() { return { id: 'sticker-created' }; } async edit(sticker) { return { id: sticker }; } async delete() {} }
  class GuildInviteManager { async create() { return { code: 'invite-created' }; } async delete() {} }
  class GuildScheduledEventManager { async create() { return { id: 'event-created' }; } async edit(event) { return { id: event }; } async delete() {} }
  class AutoModerationRuleManager { async create() { return { id: 'rule-created' }; } async edit(rule) { return { id: rule }; } async delete() {} }
  const guild = createGuild({ emojis: new GuildEmojiManager(), stickers: new GuildStickerManager(), invites: new GuildInviteManager(), scheduledEvents: new GuildScheduledEventManager(), autoModerationRules: new AutoModerationRuleManager() });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: true });
  await guild.emojis.create({ attachment: 'emoji' });
  await guild.emojis.edit('emoji-updated', { name: 'updated' });
  await guild.emojis.delete('emoji-deleted');
  await guild.stickers.create({ file: 'sticker' });
  await guild.stickers.edit('sticker-updated', { name: 'updated' });
  await guild.stickers.delete('sticker-deleted');
  await guild.invites.create('channel');
  await guild.invites.delete('invite-deleted');
  await guild.scheduledEvents.create({ name: 'event' });
  await guild.scheduledEvents.edit('event-updated', { name: 'updated' });
  await guild.scheduledEvents.delete('event-deleted');
  await guild.autoModerationRules.create({ name: 'rule' });
  await guild.autoModerationRules.edit('rule-updated', { name: 'updated' });
  await guild.autoModerationRules.delete('rule-deleted');
  assert.deepEqual((await parity.ledger.entries()).map(entry => [entry.actionType, entry.targetId]), [
    ['EMOJI_CREATE', 'emoji-created'], ['EMOJI_UPDATE', 'emoji-updated'], ['EMOJI_DELETE', 'emoji-deleted'],
    ['STICKER_CREATE', 'sticker-created'], ['STICKER_UPDATE', 'sticker-updated'], ['STICKER_DELETE', 'sticker-deleted'],
    ['INVITE_CREATE', 'invite-created'], ['INVITE_DELETE', 'invite-deleted'],
    ['GUILD_SCHEDULED_EVENT_CREATE', 'event-created'], ['GUILD_SCHEDULED_EVENT_UPDATE', 'event-updated'], ['GUILD_SCHEDULED_EVENT_DELETE', 'event-deleted'],
    ['AUTO_MODERATION_RULE_CREATE', 'rule-created'], ['AUTO_MODERATION_RULE_UPDATE', 'rule-updated'], ['AUTO_MODERATION_RULE_DELETE', 'rule-deleted'],
  ]);
  parity.detach();
});

test('autoWrap maps nested permission overwrite and thread managers', async () => {
  class GuildChannelManager { constructor(channel) { this.cache = new Map([[channel.id, channel]]); } }
  class PermissionOverwriteManager { async create(target) { return target; } async edit(target) { return target; } async delete(target) { return target; } }
  class GuildTextThreadManager { async create() { return { id: 'thread-created' }; } }
  const channel = { id: 'channel', guildId: 'guild', permissionOverwrites: new PermissionOverwriteManager(), threads: new GuildTextThreadManager() };
  const guild = createGuild({ channels: new GuildChannelManager(channel) });
  const parity = attach(createClient(guild), { clock, runtime: false, autoWrap: true });
  await channel.permissionOverwrites.create('overwrite-created', {});
  await channel.permissionOverwrites.edit({ id: 'overwrite-updated' }, {});
  await channel.permissionOverwrites.delete('overwrite-deleted');
  await channel.threads.create({ name: 'thread' });
  assert.deepEqual((await parity.ledger.entries()).map(entry => [entry.actionType, entry.targetId]), [
    ['CHANNEL_OVERWRITE_CREATE', 'overwrite-created'], ['CHANNEL_OVERWRITE_UPDATE', 'overwrite-updated'], ['CHANNEL_OVERWRITE_DELETE', 'overwrite-deleted'], ['THREAD_CREATE', 'thread-created'],
  ]);
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
