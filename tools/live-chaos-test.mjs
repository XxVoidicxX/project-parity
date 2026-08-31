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
const mutationCount = Number(process.env.PARITY_CHAOS_MUTATIONS ?? 100);
if (!token || !guildId) {
  console.log('Set DISCORD_BOT_TOKEN and PARITY_GUILD_ID to run the live chaos test.');
  process.exit(0);
}
if (!Number.isSafeInteger(mutationCount) || mutationCount < 100 || mutationCount > 1000) throw new Error('PARITY_CHAOS_MUTATIONS must be an integer from 100 through 1000.');

const { ChannelType, Client, Events, GatewayIntentBits } = await import('discord.js');
const { attach } = await import('../parity-js/src/index.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages] });
const reports = [];
const audits = [];
const results = [];
let channel;
let parity;

const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const waitFor = async (predicate, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await wait(250);
  }
  return false;
};

async function cleanup() {
  try { parity?.detach(); } catch {}
  try { await channel?.delete('parity live chaos cleanup'); } catch (error) { record('cleanup', false, error.message); }
  client.destroy();
}

client.on('guildAuditLogEntryCreate', (entry, guild) => {
  if (String(guild.id) !== String(guildId) || entry.action !== 11 || String(entry.targetId ?? entry.target?.id) !== String(channel?.id)) return;
  audits.push({ id: String(entry.id), count: Number(entry.extra?.count ?? 1) });
});

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    channel = await guild.channels.create({ name: `parity-chaos-${Date.now().toString().slice(-6)}`, type: ChannelType.GuildText, reason: 'parity live chaos test' });
    parity = attach(client, { runtime: false, strategies: [{ send: async report => reports.push(report) }] });
    const journalStart = parity.journal.entries().length;
    await Promise.all(Array.from({ length: mutationCount }, (_, index) => parity.track(
      message => ({ actionType: 'MESSAGE_CREATE', targetId: String(message.id), targetType: 'message', guildId: String(guildId) }),
      () => channel.send(`parity chaos message ${index}`),
    )));
    await parity.intent({ actionType: 'CHANNEL_UPDATE', targetId: String(channel.id), targetType: 'channel', guildId: String(guildId) });
    await channel.setTopic('parity chaos audit probe', 'parity live chaos audit probe');
    record('submitted live tracked messages and audit probe', true, `messages=${mutationCount} auditUpdates=1`);
    const settled = await waitFor(async () => (await parity.ledger.entries()).length === 0 || reports.length > 0, 120000);
    const remaining = await parity.ledger.entries();
    const journal = parity.journal.entries().slice(journalStart);
    const matchedMessages = journal.filter(entry => entry.phase === 'discord-matched' && entry.event.actionType === 'MESSAGE_CREATE' && entry.event.targetType === 'message').reduce((sum, entry) => sum + entry.matchedCorrelationIds.length, 0);
    const matchedAudit = journal.some(entry => entry.phase === 'discord-matched' && entry.event.actionType === 'CHANNEL_UPDATE' && String(entry.event.targetId) === String(channel.id));
    record('all live messages reconcile without drift', settled && reports.length === 0 && remaining.length === 0 && matchedMessages === mutationCount, `matched=${matchedMessages} remaining=${remaining.length} drifts=${reports.length}`);
    record('audit probe reconciles after the message burst', matchedAudit && audits.length >= 1, `auditEntries=${audits.length}`);
  } catch (error) {
    record('live chaos test completed', false, `${error instanceof Error ? error.name : 'Error'}: ${error.message}`);
  } finally {
    await cleanup();
    const failed = results.filter(result => !result.pass).length;
    console.log(`${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
});

client.on('error', error => console.error(`Client error: ${error.message}`));
await client.login(token);
