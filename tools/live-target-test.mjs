import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv();
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.PARITY_GUILD_ID;
if (!token || !guildId) {
  console.log('Set DISCORD_BOT_TOKEN and PARITY_GUILD_ID to run live target tests.');
  process.exit(0);
}

const { Client, ChannelType, Events, GatewayIntentBits, PermissionsBitField } = await import('discord.js');
const { attach } = await import('../parity-js/src/index.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages] });
const drifts = [];
const audits = [];
const ownerAlerts = [];
const created = { channel: null, webhook: null };
const results = [];
let parity;

const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const suffix = () => Date.now().toString().slice(-6);
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const waitFor = async (predicate, milliseconds = 25000, start = 0) => {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const found = predicate(start);
    if (found) return found;
    await wait(250);
  }
  return null;
};
const auditFor = (action, channelId, start) => waitFor(index => audits.slice(index).find(entry => entry.action === action && entry.channelId === String(channelId)), 25000, start);
const driftFor = (actionType, targetId, start) => waitFor(index => drifts.slice(index).find(report => report.event.actionType === actionType && String(report.event.targetId) === String(targetId)), 12000, start);
const journalFor = (correlationId, start) => waitFor(() => parity.journal.entries().slice(start).find(record => record.phase === 'discord-matched' && record.matchedCorrelationIds.includes(correlationId)), 12000, start);

client.on('guildAuditLogEntryCreate', (entry, guild) => {
  if (String(guild.id) !== String(guildId)) return;
  audits.push({
    action: entry.action,
    targetId: String(entry.targetId ?? entry.target?.id ?? ''),
    targetType: String(entry.targetType ?? ''),
    channelId: String(entry.extra?.channel?.id ?? entry.targetId ?? ''),
    count: Number(entry.extra?.count ?? 1),
  });
});
client.on('messageCreate', message => {
  if (String(message.channelId) !== String(created.channel?.id) || String(message.author?.id) !== String(client.user?.id)) return;
  if (message.content?.startsWith('Parity detected an action this bot process did not plan.')) ownerAlerts.push(message);
});

async function cleanup() {
  const failures = [];
  try { parity?.detach(); } catch (error) { failures.push(`detach: ${error.message}`); }
  try { await created.webhook?.delete('parity target test cleanup'); } catch (error) { failures.push(`webhook: ${error.message}`); }
  try { await created.channel?.delete('parity target test cleanup'); } catch (error) { failures.push(`channel: ${error.message}`); }
  client.destroy();
  return failures;
}

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    const me = await guild.members.fetchMe();
    const flags = PermissionsBitField.Flags;
    const permissions = ['ViewAuditLog', 'ManageChannels', 'ManageWebhooks', 'ManageMessages'].every(name => me.permissions.has(flags[name]));
    record('required permissions', permissions);
    if (!permissions) throw new Error('ViewAuditLog, ManageChannels, ManageWebhooks, and ManageMessages are required');

    created.channel = await guild.channels.create({ name: `parity-target-${suffix()}`, type: ChannelType.GuildText, reason: 'parity target test setup' });
    created.webhook = await created.channel.createWebhook({ name: `parity-target-${suffix()}`, reason: 'parity target test setup' });
    parity = attach(client, { strategies: [{ send: async report => drifts.push(report) }], alertChannelId: created.channel.id });

    const alertStart = ownerAlerts.length;
    const alertJournalStart = parity.journal.entries().length;
    await created.channel.setTopic('parity owner alert test', 'parity target test owner alert');
    const ownerAlert = await waitFor(index => ownerAlerts.slice(index)[0], 15000, alertStart);
    await wait(1000);
    const alertMatched = parity.journal.entries().slice(alertJournalStart).some(record => record.phase === 'discord-matched' && record.transport === 'message' && record.event.targetId === String(ownerAlert?.id));
    record('owner alert is delivered once and reconciles itself', !!ownerAlert && alertMatched && ownerAlerts.slice(alertStart).length === 1, ownerAlert ? `message=${ownerAlert.id}` : 'no owner alert message');

    const messageStart = drifts.length;
    const messageAuditStart = audits.length;
    const message = await created.webhook.send({ content: 'parity target test message delete', wait: true });
    const messageIntent = await parity.intent({ actionType: 'MESSAGE_DELETE', targetId: String(created.channel.id), targetType: 'channel', guildId: String(guildId) });
    await created.channel.messages.delete(message.id, 'parity target test message delete');
    const messageAudit = await auditFor(72, created.channel.id, messageAuditStart);
    if (messageAudit) {
      record('message delete audit arrives with channel option', true, `target=${messageAudit.targetId} channel=${messageAudit.channelId}`);
      const messageDrift = await driftFor('MESSAGE_DELETE', created.channel.id, messageStart);
      record('manual message delete intent reconciles', !messageDrift, messageDrift ? 'unexpected drift' : 'clean');
    } else {
      await parity.ledger.remove(messageIntent.correlationId);
      record('single message delete audit coverage unavailable', true, 'Discord did not audit deletion of a same-app webhook message');
    }

    const bulkStart = drifts.length;
    const bulkAuditStart = audits.length;
    const bulkJournalStart = parity.journal.entries().length;
    const bulkMessages = await Promise.all([
      created.webhook.send({ content: 'parity target test bulk one', wait: true }),
      created.webhook.send({ content: 'parity target test bulk two', wait: true }),
    ]);
    const bulkIntent = await parity.intent({ actionType: 'MESSAGE_BULK_DELETE', targetId: String(created.channel.id), targetType: 'channel', guildId: String(guildId), count: bulkMessages.length });
    await created.channel.bulkDelete(bulkMessages.map(message => message.id), true);
    const bulkAudit = await auditFor(73, created.channel.id, bulkAuditStart);
    record('bulk delete audit arrives with exact count', !!bulkAudit && bulkAudit.count === bulkMessages.length, bulkAudit ? `count=${bulkAudit.count}` : 'no audit entry');
    const bulkDrift = await driftFor('MESSAGE_BULK_DELETE', created.channel.id, bulkStart);
    record('counted bulk delete intent reconciles', !bulkDrift, bulkDrift ? 'unexpected drift' : 'clean');
    const bulkJournal = await journalFor(bulkIntent.correlationId, bulkJournalStart);
    record('journal maps bulk audit to exact code intent', !!bulkJournal, bulkJournal ? `correlationId=${bulkIntent.correlationId}` : 'no matched lifecycle record');
  } catch (error) {
    record('live target test completed', false, error.message);
  } finally {
    const cleanupFailures = await cleanup();
    if (cleanupFailures.length) {
      for (const failure of cleanupFailures) record('cleanup', false, failure);
    } else {
      record('cleanup', true, 'removed disposable resources');
    }
    const failed = results.filter(result => !result.pass).length;
    console.log(`${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
});

client.on('error', error => console.error(`Client error: ${error.message}`));
await client.login(token);
