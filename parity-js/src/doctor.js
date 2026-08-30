const permission = (permissions, name) => Boolean(permissions?.has?.(name));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function inspectOnboarding({ client, guildId, alertChannelId, alertUserId = null } = {}) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  if (!client?.user?.id) {
    add('Discord connection', false, 'The client is not logged in.');
    return { ok: false, checks };
  }
  add('Discord connection', true, `Logged in as ${client.user.id}.`);
  if (!guildId) add('Guild configuration', false, 'Set PARITY_GUILD_ID.');
  if (!alertChannelId) add('Alert channel configuration', false, 'Set PARITY_ALERT_CHANNEL_ID.');
  if (!guildId || !alertChannelId) return { ok: false, checks };
  let guild;
  let me;
  let channel;
  try {
    guild = await client.guilds.fetch(String(guildId));
    me = await guild.members.fetchMe();
    add('Guild access', true, `Connected to ${guild.id}.`);
  } catch (error) {
    add('Guild access', false, error.message);
    return { ok: false, checks };
  }
  add('Audit-log permission', permission(me.permissions, 'ViewAuditLog'), permission(me.permissions, 'ViewAuditLog') ? 'ViewAuditLog is granted.' : 'Grant ViewAuditLog to the bot.');
  try {
    channel = await client.channels.fetch(String(alertChannelId));
  } catch (error) {
    add('Alert channel access', false, error.message);
    return { ok: false, checks };
  }
  const botPermissions = channel?.permissionsFor?.(me);
  add('Alert channel type', Boolean(channel?.isTextBased?.()), channel?.isTextBased?.() ? 'The alert destination is text-based.' : 'Configure a guild text channel.');
  add('Alert channel permissions', permission(botPermissions, 'ViewChannel') && permission(botPermissions, 'SendMessages'), permission(botPermissions, 'ViewChannel') && permission(botPermissions, 'SendMessages') ? 'The bot can view and send alerts.' : 'Grant ViewChannel and SendMessages to the bot.');
  const everyonePermissions = channel?.permissionsFor?.(guild.roles?.everyone);
  add('Alert channel privacy', !permission(everyonePermissions, 'ViewChannel'), !permission(everyonePermissions, 'ViewChannel') ? 'The @everyone role cannot view alerts.' : 'Remove ViewChannel from @everyone or choose a private channel.');
  if (alertUserId) {
    try {
      const owner = await guild.members.fetch(String(alertUserId));
      add('Owner visibility', permission(channel.permissionsFor?.(owner), 'ViewChannel'), permission(channel.permissionsFor?.(owner), 'ViewChannel') ? 'The configured owner can view alerts.' : 'Grant ViewChannel to the configured owner.');
    } catch (error) {
      add('Owner visibility', false, error.message);
    }
  } else {
    add('Owner visibility', true, 'No owner mention is configured.');
  }
  return { ok: checks.every(check => check.pass), checks };
}

export async function runOnboardingDoctor({ client, parity, guildId, alertChannelId, alertUserId = null, sendTest = false, timeoutMs = 15000 } = {}) {
  const inspection = await inspectOnboarding({ client, guildId, alertChannelId, alertUserId });
  if (!sendTest || !inspection.ok) return inspection;
  const checks = [...inspection.checks];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  let testMessage = null;
  try {
    const message = testMessage = await parity.testOwnerAlert();
    const end = Date.now() + timeoutMs;
    let matched = false;
    while (Date.now() < end) {
      matched = parity.journal.entries().some(record => record.phase === 'discord-matched' && record.transport === 'message' && record.event.targetId === String(message.id));
      if (matched) break;
      await sleep(100);
    }
    add('Tracked test alert', matched, matched ? `Test message ${message.id} was delivered and reconciled.` : 'The test message did not reconcile before the timeout.');
  } catch (error) {
    add('Tracked test alert', false, error.message);
  }
  return { ok: checks.every(check => check.pass), checks, testMessage };
}
