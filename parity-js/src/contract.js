export const collapsedActions = new Set(['MEMBER_MOVE', 'MEMBER_DISCONNECT', 'MESSAGE_DELETE']);
export const auditActionNames = new Map([[1, 'GUILD_UPDATE'], [10, 'CHANNEL_CREATE'], [11, 'CHANNEL_UPDATE'], [12, 'CHANNEL_DELETE'], [13, 'CHANNEL_OVERWRITE_CREATE'], [14, 'CHANNEL_OVERWRITE_UPDATE'], [15, 'CHANNEL_OVERWRITE_DELETE'], [20, 'MEMBER_KICK'], [21, 'MEMBER_PRUNE'], [22, 'MEMBER_BAN_ADD'], [23, 'MEMBER_BAN_REMOVE'], [24, 'MEMBER_UPDATE'], [25, 'MEMBER_ROLE_UPDATE'], [26, 'MEMBER_MOVE'], [27, 'MEMBER_DISCONNECT'], [28, 'BOT_ADD'], [30, 'ROLE_CREATE'], [31, 'ROLE_UPDATE'], [32, 'ROLE_DELETE'], [40, 'INVITE_CREATE'], [41, 'INVITE_UPDATE'], [42, 'INVITE_DELETE'], [50, 'WEBHOOK_CREATE'], [51, 'WEBHOOK_UPDATE'], [52, 'WEBHOOK_DELETE'], [60, 'EMOJI_CREATE'], [61, 'EMOJI_UPDATE'], [62, 'EMOJI_DELETE'], [72, 'MESSAGE_DELETE'], [73, 'MESSAGE_BULK_DELETE'], [74, 'MESSAGE_PIN'], [75, 'MESSAGE_UNPIN'], [80, 'INTEGRATION_CREATE'], [81, 'INTEGRATION_UPDATE'], [82, 'INTEGRATION_DELETE'], [83, 'STAGE_INSTANCE_CREATE'], [84, 'STAGE_INSTANCE_UPDATE'], [85, 'STAGE_INSTANCE_DELETE'], [90, 'STICKER_CREATE'], [91, 'STICKER_UPDATE'], [92, 'STICKER_DELETE'], [100, 'GUILD_SCHEDULED_EVENT_CREATE'], [101, 'GUILD_SCHEDULED_EVENT_UPDATE'], [102, 'GUILD_SCHEDULED_EVENT_DELETE'], [110, 'THREAD_CREATE'], [111, 'THREAD_UPDATE'], [112, 'THREAD_DELETE'], [121, 'APPLICATION_COMMAND_PERMISSION_UPDATE'], [130, 'SOUNDBOARD_SOUND_CREATE'], [131, 'SOUNDBOARD_SOUND_UPDATE'], [132, 'SOUNDBOARD_SOUND_DELETE'], [140, 'AUTO_MODERATION_RULE_CREATE'], [141, 'AUTO_MODERATION_RULE_UPDATE'], [142, 'AUTO_MODERATION_RULE_DELETE'], [143, 'AUTO_MODERATION_BLOCK_MESSAGE'], [144, 'AUTO_MODERATION_FLAG_TO_CHANNEL'], [145, 'AUTO_MODERATION_USER_COMMUNICATION_DISABLED'], [146, 'AUTO_MODERATION_QUARANTINE_USER'], [150, 'CREATOR_MONETIZATION_REQUEST_CREATED'], [151, 'CREATOR_MONETIZATION_TERMS_ACCEPTED'], [163, 'ONBOARDING_PROMPT_CREATE'], [164, 'ONBOARDING_PROMPT_UPDATE'], [165, 'ONBOARDING_PROMPT_DELETE'], [166, 'ONBOARDING_CREATE'], [167, 'ONBOARDING_UPDATE'], [190, 'HOME_SETTINGS_CREATE'], [191, 'HOME_SETTINGS_UPDATE'], [192, 'VOICE_CHANNEL_STATUS_CREATE'], [193, 'VOICE_CHANNEL_STATUS_DELETE']]);
export const iso = value => new Date(value).toISOString();
export const actionName = value => typeof value === 'string' ? value : auditActionNames.get(value) ?? `UNKNOWN_${value}`;
export const stringId = value => value == null ? '' : String(value);
export const nearestProjection = entry => entry ? ({ actionType: entry.actionType, targetId: entry.targetId, guildId: entry.guildId, correlationId: entry.correlationId, timestamp: entry.timestamp, expiresAt: entry.expiresAt }) : null;

const usableId = value => value == null || value === '' || value === 'unknown' ? null : String(value);
const firstId = (...values) => values.map(usableId).find(value => value != null);
const canonicalType = value => {
  const normalized = String(value ?? 'unknown').replace(/Manager$/, '').toLowerCase();
  return ({ guildmember: 'user', member: 'user', stage_instance: 'stageinstance' })[normalized] ?? normalized;
};

export function canonicalAuditTarget(actionType, entry = {}, guildId = '') {
  const extra = entry.extra ?? entry.options ?? {};
  const target = entry.target ?? {};
  const genericId = firstId(entry.targetId, entry.target_id, target.id);
  const genericType = canonicalType(entry.targetType ?? target.type ?? target.constructor?.name);
  const channelId = firstId(extra.channel?.id, extra.channelId, extra.channel_id, extra.channel?.channelId);
  const messageId = firstId(extra.messageId, extra.message_id);
  const overwriteId = firstId(extra.overwrite?.id, extra.id);
  const inviteChange = entry.changes?.find(change => change.key === 'code');
  const inviteCode = firstId(entry.targetCode, target.code, inviteChange?.new, inviteChange?.old, inviteChange?.new_value, inviteChange?.old_value);
  const resolvedGuildId = firstId(guildId, entry.guildId, entry.guild_id, entry.guild?.id) ?? 'unknown';

  if (actionType.startsWith('CHANNEL_OVERWRITE_')) {
    const id = genericId && overwriteId ? `${genericId}:${overwriteId}` : overwriteId ?? genericId ?? 'unknown';
    return { targetId: id, targetType: 'overwrite' };
  }
  if (actionType === 'MESSAGE_DELETE') return { targetId: channelId ?? 'unknown', targetType: 'channel' };
  if (actionType === 'MESSAGE_BULK_DELETE') return { targetId: genericId ?? channelId ?? 'unknown', targetType: 'channel' };
  if (actionType === 'MESSAGE_PIN' || actionType === 'MESSAGE_UNPIN') return { targetId: messageId ?? 'unknown', targetType: 'message' };
  if (actionType === 'MEMBER_MOVE') return { targetId: channelId ?? 'unknown', targetType: 'channel' };
  if (actionType === 'MEMBER_DISCONNECT' || actionType === 'MEMBER_PRUNE') return { targetId: resolvedGuildId, targetType: 'guild' };
  if (actionType.startsWith('INVITE_')) return { targetId: inviteCode ?? genericId ?? 'unknown', targetType: 'invite' };
  if (actionType === 'HOME_SETTINGS_CREATE' || actionType === 'HOME_SETTINGS_UPDATE' || actionType === 'ONBOARDING_CREATE' || actionType === 'ONBOARDING_UPDATE') return { targetId: resolvedGuildId, targetType: 'guild' };
  if (actionType.startsWith('VOICE_CHANNEL_STATUS_')) return { targetId: channelId ?? genericId ?? 'unknown', targetType: 'channel' };
  if (['AUTO_MODERATION_BLOCK_MESSAGE', 'AUTO_MODERATION_FLAG_TO_CHANNEL', 'AUTO_MODERATION_USER_COMMUNICATION_DISABLED', 'AUTO_MODERATION_QUARANTINE_USER'].includes(actionType)) return { targetId: genericId ?? 'unknown', targetType: 'user' };
  return { targetId: genericId ?? 'unknown', targetType: genericType };
}
