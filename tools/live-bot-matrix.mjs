import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
  console.log('Set DISCORD_BOT_TOKEN and PARITY_GUILD_ID to run the live bot matrix.');
  process.exit(0);
}

const catalog = JSON.parse(readFileSync(join(resolve(process.cwd()), 'examples', 'bot-matrix', 'catalog.json'), 'utf8')).variants;
const { ChannelType, Client, Events, GatewayIntentBits } = await import('discord.js');
const { attach } = await import('../parity-js/src/index.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildModeration] });
const reports = [];
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
  try { await channel?.delete('parity live bot matrix cleanup'); } catch (error) { record('cleanup', false, error.message); }
  client.destroy();
}

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    channel = await guild.channels.create({ name: `parity-bot-matrix-${Date.now().toString().slice(-6)}`, type: ChannelType.GuildText, reason: 'parity bot matrix test' });
    const baseline = await Promise.all(catalog.map(profile => channel.send(`baseline ${profile.id}`)));
    record('all catalog bots work without Parity', baseline.length === catalog.length, `sent=${baseline.length}`);
    await wait(1000);
    parity = attach(client, { runtime: false, strategies: [{ send: async report => reports.push(report) }] });
    const journalStart = parity.journal.entries().length;
    const tracked = await Promise.all(catalog.map(profile => parity.track(
      message => ({ actionType: 'MESSAGE_CREATE', targetId: String(message.id), targetType: 'message', guildId: String(guildId) }),
      () => channel.send(`parity ${profile.id}`),
    )));
    const settled = await waitFor(async () => (await parity.ledger.entries()).length === 0 || reports.length > 0, 180000);
    const remaining = await parity.ledger.entries();
    const matched = parity.journal.entries().slice(journalStart).filter(entry => entry.phase === 'discord-matched' && entry.event.actionType === 'MESSAGE_CREATE').reduce((sum, entry) => sum + entry.matchedCorrelationIds.length, 0);
    record('all catalog bots work with Parity', tracked.length === catalog.length && settled && reports.length === 0 && remaining.length === 0 && matched === catalog.length, `sent=${tracked.length} matched=${matched} remaining=${remaining.length} drifts=${reports.length}`);
  } catch (error) {
    record('live bot matrix completed', false, `${error instanceof Error ? error.name : 'Error'}: ${error.message}`);
  } finally {
    await cleanup();
    const failed = results.filter(result => !result.pass).length;
    console.log(`${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
});

client.on('error', error => console.error(`Client error: ${error.message}`));
await client.login(token);
