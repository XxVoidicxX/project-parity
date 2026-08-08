import { actionName } from './contract.js';

const REST_ACTION_MAP = new Map([
  ['GuildRoleManager',    { create: ['ROLE_CREATE', 'role'], edit: ['ROLE_UPDATE', 'role'], delete: ['ROLE_DELETE', 'role'] }],
  ['GuildChannelManager', { create: ['CHANNEL_CREATE', 'channel'], edit: ['CHANNEL_UPDATE', 'channel'], delete: ['CHANNEL_DELETE', 'channel'] }],
  ['GuildMemberManager',  { kick: ['MEMBER_KICK', 'member'], ban: ['MEMBER_BAN_ADD', 'user'], edit: ['MEMBER_UPDATE', 'member'] }],
  ['GuildBanManager',     { create: ['MEMBER_BAN_ADD', 'user'], remove: ['MEMBER_BAN_REMOVE', 'user'] }],
  ['WebhookClient',       { edit: ['WEBHOOK_UPDATE', 'webhook'], delete: ['WEBHOOK_DELETE', 'webhook'] }],
]);

function resolveTargetId(args) {
  const first = args[0];
  if (first == null) return 'unknown';
  if (typeof first === 'string') return first;
  if (typeof first === 'bigint') return String(first);
  if (first.id != null) return String(first.id);
  if (first.user?.id != null) return String(first.user.id);
  return 'unknown';
}

function wrapManager(manager, ledger, guildId) {
  const managerClass = manager?.constructor?.name;
  const methodMap = REST_ACTION_MAP.get(managerClass);
  if (!methodMap) return manager;

  return new Proxy(manager, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function' || !methodMap[prop]) return typeof value === 'function' ? value.bind(target) : value;
      const [actionType, targetType] = methodMap[prop];
      return async function (...args) {
        const targetId = resolveTargetId(args);
        const resolvedGuildId = guildId ?? String(target.guild?.id ?? target.client?.guilds?.cache?.first()?.id ?? 'unknown');
        await ledger.record({ actionType, targetId, targetType, guildId: resolvedGuildId });
        return target[prop].apply(target, args);
      };
    },
  });
}

export function attachAutoWrap(client, parity) {
  const ledger = parity.ledger;

  client.guilds.cache.forEach(guild => {
    guild.roles    = wrapManager(guild.roles,    ledger, String(guild.id));
    guild.channels = wrapManager(guild.channels, ledger, String(guild.id));
    guild.members  = wrapManager(guild.members,  ledger, String(guild.id));
    guild.bans     = wrapManager(guild.bans,     ledger, String(guild.id));
  });

  client.on('guildCreate', guild => {
    guild.roles    = wrapManager(guild.roles,    ledger, String(guild.id));
    guild.channels = wrapManager(guild.channels, ledger, String(guild.id));
    guild.members  = wrapManager(guild.members,  ledger, String(guild.id));
    guild.bans     = wrapManager(guild.bans,     ledger, String(guild.id));
  });

  return parity;
}
