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
  console.log('Set DISCORD_BOT_TOKEN and PARITY_GUILD_ID to run the live doctor test.');
  process.exit(0);
}

const { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits } = await import('discord.js');
const { attach, runOnboardingDoctor } = await import('../parity-js/src/index.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages] });
const results = [];
let channel;
let parity;

const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

async function cleanup() {
  try { parity?.detach(); } catch {}
  try { await channel?.delete('parity doctor test cleanup'); } catch (error) { record('cleanup', false, error.message); }
  client.destroy();
}

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    const me = await guild.members.fetchMe();
    channel = await guild.channels.create({
      name: `parity-doctor-${Date.now().toString().slice(-6)}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
      reason: 'parity live doctor test',
    });
    parity = attach(client, { alertChannelId: channel.id });
    const doctor = await runOnboardingDoctor({ client, parity, guildId, alertChannelId: channel.id, sendTest: true });
    for (const check of doctor.checks) record(check.name, check.pass, check.detail);
  } catch (error) {
    record('live doctor completed', false, error.message);
  } finally {
    await cleanup();
    const failed = results.filter(result => !result.pass).length;
    console.log(`${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
});

client.on('error', error => console.error(`Client error: ${error.message}`));
await client.login(token);
