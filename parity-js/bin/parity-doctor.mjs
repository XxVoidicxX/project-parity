import { Client, Events, GatewayIntentBits } from 'discord.js';
import { attach } from '../src/index.js';
import { runOnboardingDoctor } from '../src/doctor.js';

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.PARITY_GUILD_ID;
const alertChannelId = process.env.PARITY_ALERT_CHANNEL_ID;
const alertUserId = process.env.PARITY_ALERT_USER_ID;
const sendTest = process.argv.includes('--send-test');

if (!token || !guildId || !alertChannelId) {
  console.error('Set DISCORD_BOT_TOKEN, PARITY_GUILD_ID, and PARITY_ALERT_CHANNEL_ID.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages] });
client.once(Events.ClientReady, async () => {
  const parity = attach(client, { alertChannelId, alertUserId });
  const result = await runOnboardingDoctor({ client, parity, guildId, alertChannelId, alertUserId, sendTest });
  for (const check of result.checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  parity.detach();
  client.destroy();
  process.exit(result.ok ? 0 : 1);
});
client.on('error', error => console.error(`Discord client error: ${error.message}`));
await client.login(token);
