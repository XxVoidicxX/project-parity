const REST_ACTION_MAP = new Map([
  ['RoleManager',         { create: ['ROLE_CREATE', 'role', 'after'], edit: ['ROLE_UPDATE', 'role'], delete: ['ROLE_DELETE', 'role'] }],
  ['GuildChannelManager', { create: ['CHANNEL_CREATE', 'channel', 'after'], edit: ['CHANNEL_UPDATE', 'channel'], delete: ['CHANNEL_DELETE', 'channel'] }],
  ['GuildMemberManager',  { kick: ['MEMBER_KICK', 'user'], ban: ['MEMBER_BAN_ADD', 'user'], edit: ['MEMBER_UPDATE', 'user'] }],
  ['GuildBanManager',     { create: ['MEMBER_BAN_ADD', 'user'], remove: ['MEMBER_BAN_REMOVE', 'user'] }],
  ['WebhookClient',       { edit: ['WEBHOOK_UPDATE', 'webhook'], delete: ['WEBHOOK_DELETE', 'webhook'] }],
]);

const AUTOMATIC_MANAGERS = new Set(['RoleManager', 'GuildChannelManager', 'GuildMemberManager', 'GuildBanManager']);
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
  if (first.user?.id != null) return String(first.user.id);
  return 'unknown';
}

function pushUnique(list, item, key) {
  if (!list.some(existing => key(existing) === key(item))) list.push(item);
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
          options.onUnsupportedCall?.({ ...observation });
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

  const wrapGuild = guild => {
    for (const slot of ['roles', 'channels', 'members', 'bans']) {
      const original = guild[slot];
      const wrapped = wrapManager(original, parityIntent, parityCancel, String(guild.id), parityTrack, state, options, slot);
      if (wrapped === original) continue;
      guild[slot] = wrapped;
      installed.push({ guild, slot, original, wrapped });
    }
  };

  client.guilds?.cache?.forEach(wrapGuild);
  const guildCreateHandler = guild => wrapGuild(guild);
  client.on('guildCreate', guildCreateHandler);

  const originalDetach = parity.detach.bind(parity);
  parity.getAutoWrapCoverage = () => structuredClone(state);
  parity.wrapManager = (manager, guildId) => wrapManager(manager, parityIntent, parityCancel, String(guildId ?? 'unknown'), parityTrack, state, options, 'manual');
  parity.detach = () => {
    client.off?.('guildCreate', guildCreateHandler);
    for (const { guild, slot, original, wrapped } of installed) if (guild[slot] === wrapped) guild[slot] = original;
    delete parity[AUTO_WRAP_STATE];
    delete parity.getAutoWrapCoverage;
    delete parity.wrapManager;
    parity.detach = originalDetach;
    return originalDetach();
  };
  parity[AUTO_WRAP_STATE] = state;
  return parity;
}
