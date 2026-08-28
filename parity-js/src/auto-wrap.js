const REST_ACTION_MAP = new Map([
  ['RoleManager',         { create: ['ROLE_CREATE', 'role', 'after'], edit: ['ROLE_UPDATE', 'role'], delete: ['ROLE_DELETE', 'role'] }],
  ['GuildChannelManager', { create: ['CHANNEL_CREATE', 'channel', 'after'], edit: ['CHANNEL_UPDATE', 'channel'], delete: ['CHANNEL_DELETE', 'channel'] }],
  ['GuildMemberManager',  { kick: ['MEMBER_KICK', 'user'], ban: ['MEMBER_BAN_ADD', 'user'], edit: ['MEMBER_UPDATE', 'user'] }],
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

function wrapManager(manager, ledger, guildId, parityTrack) {
  const managerClass = manager?.constructor?.name;
  const methodMap = REST_ACTION_MAP.get(managerClass);
  if (!methodMap) return manager;

  return new Proxy(manager, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function' || !methodMap[prop]) return typeof value === 'function' ? value.bind(target) : value;
      const [actionType, targetType, phase = 'before'] = methodMap[prop];
      return async function (...args) {
        const resolvedGuildId = guildId ?? String(target.guild?.id ?? target.client?.guilds?.cache?.first()?.id ?? 'unknown');
        if (phase === 'after') {
          if (typeof parityTrack !== 'function') throw new Error('Auto-wrap create operations require parity.track');
          return parityTrack(
            result => ({ actionType, targetId: resolveTargetId([result]), targetType, guildId: resolvedGuildId }),
            () => target[prop].apply(target, args),
          );
        }
        const entry = await ledger.record({ actionType, targetId: resolveTargetId(args), targetType, guildId: resolvedGuildId });
        try {
          return await target[prop].apply(target, args);
        } catch (error) {
          await ledger.remove(entry.correlationId);
          throw error;
        }
      };
    },
  });
}

export function attachAutoWrap(client, parity) {
  const ledger = parity.ledger;
  const parityTrack = parity.track?.bind(parity);

  client.guilds.cache.forEach(guild => {
    guild.roles    = wrapManager(guild.roles,    ledger, String(guild.id), parityTrack);
    guild.channels = wrapManager(guild.channels, ledger, String(guild.id), parityTrack);
    guild.members  = wrapManager(guild.members,  ledger, String(guild.id), parityTrack);
    guild.bans     = wrapManager(guild.bans,     ledger, String(guild.id), parityTrack);
  });

  client.on('guildCreate', guild => {
    guild.roles    = wrapManager(guild.roles,    ledger, String(guild.id), parityTrack);
    guild.channels = wrapManager(guild.channels, ledger, String(guild.id), parityTrack);
    guild.members  = wrapManager(guild.members,  ledger, String(guild.id), parityTrack);
    guild.bans     = wrapManager(guild.bans,     ledger, String(guild.id), parityTrack);
  });

  return parity;
}
