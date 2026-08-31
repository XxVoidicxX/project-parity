const REST_ACTION_MAP = new Map([
  ['RoleManager',         { create: ['ROLE_CREATE', 'role', 'after'], edit: ['ROLE_UPDATE', 'role'], delete: ['ROLE_DELETE', 'role'] }],
  ['GuildChannelManager', { create: ['CHANNEL_CREATE', 'channel', 'after'], edit: ['CHANNEL_UPDATE', 'channel'], delete: ['CHANNEL_DELETE', 'channel'] }],
  ['GuildMemberManager',  { kick: ['MEMBER_KICK', 'user'], ban: ['MEMBER_BAN_ADD', 'user'], edit: ['MEMBER_UPDATE', 'user'] }],
  ['GuildBanManager',     { create: ['MEMBER_BAN_ADD', 'user'], remove: ['MEMBER_BAN_REMOVE', 'user'] }],
  ['GuildEmojiManager',   { create: ['EMOJI_CREATE', 'emoji', 'after'], edit: ['EMOJI_UPDATE', 'emoji'], delete: ['EMOJI_DELETE', 'emoji'] }],
  ['GuildStickerManager', { create: ['STICKER_CREATE', 'sticker', 'after'], edit: ['STICKER_UPDATE', 'sticker'], delete: ['STICKER_DELETE', 'sticker'] }],
  ['GuildInviteManager',  { create: ['INVITE_CREATE', 'invite', 'after'], delete: ['INVITE_DELETE', 'invite'] }],
  ['GuildScheduledEventManager', { create: ['GUILD_SCHEDULED_EVENT_CREATE', 'scheduled-event', 'after'], edit: ['GUILD_SCHEDULED_EVENT_UPDATE', 'scheduled-event'], delete: ['GUILD_SCHEDULED_EVENT_DELETE', 'scheduled-event'] }],
  ['AutoModerationRuleManager', { create: ['AUTO_MODERATION_RULE_CREATE', 'auto-moderation-rule', 'after'], edit: ['AUTO_MODERATION_RULE_UPDATE', 'auto-moderation-rule'], delete: ['AUTO_MODERATION_RULE_DELETE', 'auto-moderation-rule'] }],
  ['PermissionOverwriteManager', { create: ['CHANNEL_OVERWRITE_CREATE', 'overwrite'], edit: ['CHANNEL_OVERWRITE_UPDATE', 'overwrite'], delete: ['CHANNEL_OVERWRITE_DELETE', 'overwrite'] }],
  ['GuildTextThreadManager', { create: ['THREAD_CREATE', 'thread', 'after'] }],
  ['GuildForumThreadManager', { create: ['THREAD_CREATE', 'thread', 'after'] }],
  ['WebhookClient',       { edit: ['WEBHOOK_UPDATE', 'webhook'], delete: ['WEBHOOK_DELETE', 'webhook'] }],
]);

const AUTOMATIC_MANAGERS = new Set(['RoleManager', 'GuildChannelManager', 'GuildMemberManager', 'GuildBanManager', 'GuildEmojiManager', 'GuildStickerManager', 'GuildInviteManager', 'GuildScheduledEventManager', 'AutoModerationRuleManager', 'PermissionOverwriteManager', 'GuildTextThreadManager', 'GuildForumThreadManager']);
const UNSUPPORTED_MUTATIONS = new Map([
  ['RoleManager', new Set(['setPositions'])],
  ['GuildChannelManager', new Set(['setPositions'])],
  ['GuildMemberManager', new Set(['prune'])],
  ['GuildBanManager', new Set(['bulkCreate', 'bulkRemove'])],
]);
const WRAPPED_MANAGER = Symbol('parityWrappedManager');
const AUTO_WRAP_STATE = Symbol('parityAutoWrapState');

export const AUTO_WRAP_COVERAGE = Object.freeze([...REST_ACTION_MAP].map(([managerClass, methods]) => Object.freeze({
  managerClass,
  mode: AUTOMATIC_MANAGERS.has(managerClass) ? 'automatic' : 'manual',
  methods: Object.freeze(Object.keys(methods)),
  knownUnsupportedMutations: Object.freeze([...(UNSUPPORTED_MUTATIONS.get(managerClass) ?? [])]),
})));

function resolveTargetId(args) {
  const first = args[0];
  if (first == null) return 'unknown';
  if (typeof first === 'string') return first;
  if (typeof first === 'bigint') return String(first);
  if (first.id != null) return String(first.id);
  if (first.code != null) return String(first.code);
  if (first.user?.id != null) return String(first.user.id);
  return 'unknown';
}

function pushUnique(list, item, key) {
  if (!list.some(existing => key(existing) === key(item))) list.push(item);
}

function reportUnsupported(options, observation) {
  try {
    const result = options.onUnsupportedCall?.({ ...observation });
    if (result?.then) result.catch(() => {});
  } catch {}
}

function wrapManager(manager, parityIntent, parityCancel, guildId, parityTrack, state, options = {}, slot = 'manual') {
  if (manager?.[WRAPPED_MANAGER]) return manager;
  const managerClass = manager?.constructor?.name ?? 'unknown';
  const methodMap = REST_ACTION_MAP.get(managerClass);
  if (!methodMap) {
    pushUnique(state.unsupportedManagers, { guildId, slot, managerClass }, value => `${value.guildId}:${value.slot}:${value.managerClass}`);
    return manager;
  }

  pushUnique(state.wrapped, { guildId, slot, managerClass, methods: Object.keys(methodMap) }, value => `${value.guildId}:${value.slot}:${value.managerClass}`);
  return new Proxy(manager, {
    get(target, prop) {
      if (prop === WRAPPED_MANAGER) return true;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!methodMap[prop]) {
        if (!(UNSUPPORTED_MUTATIONS.get(managerClass)?.has(prop))) return value.bind(target);
        return function (...args) {
          const observation = { guildId, slot, managerClass, method: String(prop), observedAt: new Date().toISOString() };
          state.unsupportedCalls.push(observation);
          reportUnsupported(options, observation);
          return value.apply(target, args);
        };
      }
      const [actionType, targetType, phase = 'before'] = methodMap[prop];
      return async function (...args) {
        const resolvedGuildId = guildId ?? String(target.guild?.id ?? target.client?.guilds?.cache?.first()?.id ?? 'unknown');
        if (phase === 'after') {
          if (typeof parityTrack !== 'function') throw new Error('Auto-wrap create operations require parity.track');
          return parityTrack(
            result => ({ actionType, targetId: resolveTargetId([result]), targetType, guildId: resolvedGuildId }),
            () => value.apply(target, args),
          );
        }
        const entry = await parityIntent({ actionType, targetId: resolveTargetId(args), targetType, guildId: resolvedGuildId }, 'auto-wrap');
        try {
          return await value.apply(target, args);
        } catch (error) {
          await parityCancel(entry, 'auto-wrap');
          throw error;
        }
      };
    },
  });
}

export function attachAutoWrap(client, parity, options = {}) {
  if (parity[AUTO_WRAP_STATE]) return parity;
  const parityIntent = parity.intent.bind(parity);
  const parityCancel = parity.cancelIntent.bind(parity);
  const parityTrack = parity.track?.bind(parity);
  const state = { catalogue: AUTO_WRAP_COVERAGE.map(entry => ({ ...entry, methods: [...entry.methods], knownUnsupportedMutations: [...entry.knownUnsupportedMutations] })), wrapped: [], unsupportedManagers: [], unsupportedCalls: [] };
  const installed = [];

  const install = (owner, slot, manager, guildId) => {
    const wrapped = wrapManager(manager, parityIntent, parityCancel, guildId, parityTrack, state, options, slot);
    if (wrapped === manager) return;
    owner[slot] = wrapped;
    installed.push({ owner, slot, original: manager, wrapped });
  };

  const wrapChannel = channel => {
    if (!channel) return;
    const guildId = String(channel.guild?.id ?? channel.guildId ?? 'unknown');
    install(channel, 'permissionOverwrites', channel.permissionOverwrites, guildId);
    install(channel, 'threads', channel.threads, guildId);
  };

  const wrapGuild = guild => {
    const guildId = String(guild.id);
    for (const slot of ['roles', 'channels', 'members', 'bans', 'emojis', 'stickers', 'invites', 'scheduledEvents', 'autoModerationRules']) install(guild, slot, guild[slot], guildId);
    guild.channels?.cache?.forEach(wrapChannel);
  };

  client.guilds?.cache?.forEach(wrapGuild);
  const guildCreateHandler = guild => wrapGuild(guild);
  const channelCreateHandler = channel => wrapChannel(channel);
  client.on('guildCreate', guildCreateHandler);
  client.on('channelCreate', channelCreateHandler);

  const originalDetach = parity.detach.bind(parity);
  parity.getAutoWrapCoverage = () => structuredClone(state);
  parity.wrapManager = (manager, guildId) => wrapManager(manager, parityIntent, parityCancel, String(guildId ?? 'unknown'), parityTrack, state, options, 'manual');
  parity.detach = () => {
    client.off?.('guildCreate', guildCreateHandler);
    client.off?.('channelCreate', channelCreateHandler);
    for (const { owner, slot, original, wrapped } of installed) if (owner[slot] === wrapped) owner[slot] = original;
    delete parity[AUTO_WRAP_STATE];
    delete parity.getAutoWrapCoverage;
    delete parity.wrapManager;
    parity.detach = originalDetach;
    return originalDetach();
  };
  parity[AUTO_WRAP_STATE] = state;
  return parity;
}
