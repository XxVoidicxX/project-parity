import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

loadDotEnv();
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.PARITY_GUILD_ID;
const output = option('--output');
const count = Number(option('--count') ?? 25);
const timeoutMs = Number(option('--timeout-ms') ?? 300000);
if (!token || !guildId) throw new Error('Set DISCORD_BOT_TOKEN and PARITY_GUILD_ID before capturing fixtures.');
if (!output) throw new Error('Provide --output <path> for the sanitized capture.');
if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('--count must be an integer from 1 through 1000.');
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) throw new Error('--timeout-ms must be an integer from 1000 through 3600000.');

const { Client, Events, GatewayIntentBits } = await import('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration] });
const aliases = new Map();
const snapshots = [];
let timer;

function alias(value) {
  const key = String(value ?? 'unknown');
  if (!aliases.has(key)) aliases.set(key, `id-${aliases.size + 1}`);
  return aliases.get(key);
}

function snapshot(entry, guild) {
  const extra = entry.extra ?? {};
  return {
    id: alias(entry.id),
    action: Number(entry.action),
    actionType: String(entry.actionType ?? ''),
    targetId: alias(entry.targetId ?? entry.target?.id),
    targetType: String(entry.targetType ?? ''),
    guildId: alias(guild.id),
    executorId: alias(entry.executorId ?? entry.executor?.id),
    createdTimestamp: 1704067200000 + snapshots.length,
    extra: {
      count: Number(extra.count ?? 1),
      channelId: extra.channel?.id == null ? null : alias(extra.channel.id),
    },
    changes: (entry.changes ?? []).map(change => ({ key: String(change.key), oldType: change.old == null ? null : typeof change.old, newType: change.new == null ? null : typeof change.new })),
  };
}

function finish(code, message) {
  clearTimeout(timer);
  client.destroy();
  if (message) console.log(message);
  process.exit(code);
}

client.on('guildAuditLogEntryCreate', (entry, guild) => {
  if (String(guild.id) !== String(guildId)) return;
  snapshots.push(snapshot(entry, guild));
  if (snapshots.length < count) return;
  const path = resolve(process.cwd(), output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: '1.0', sanitized: true, source: { library: 'discord.js', event: 'guildAuditLogEntryCreate' }, rawAuditEvents: snapshots }, null, 2)}\n`, 'utf8');
  finish(0, `Captured ${snapshots.length} sanitized audit shapes in ${path}`);
});

client.once(Events.ClientReady, () => {
  console.log(`Capturing ${count} audit events from guild ${alias(guildId)}.`);
  timer = setTimeout(() => finish(1, `Timed out after collecting ${snapshots.length}/${count} audit events.`), timeoutMs);
});
client.on('error', error => finish(1, `Capture failed: ${error.message}`));
await client.login(token);
