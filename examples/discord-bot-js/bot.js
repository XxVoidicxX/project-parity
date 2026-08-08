import 'dotenv/config';
import { Client, GatewayIntentBits, Events, PermissionsBitField } from 'discord.js';
import { attach } from '../../parity-js/src/index.js';

const token = process.env.DISCORD_BOT_TOKEN;
const alertChannelId = process.env.PARITY_ALERT_CHANNEL_ID;

if (!token) {
  console.error('Set DISCORD_BOT_TOKEN in .env or the environment.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function postDriftAlert(report) {
  console.error('[PARITY DRIFT]', JSON.stringify(report, null, 2));
  if (!alertChannelId) return;
  try {
    const channel = await client.channels.fetch(alertChannelId);
    if (!channel?.isTextBased()) return;
    const e = report.event;
    await channel.send(
      `**DRIFT DETECTED** - token may be in use by another process\n` +
      `Action: \`${e.actionType}\`  Target: \`${e.targetId}\`  Guild: \`${e.guildId}\`\n` +
      `Occurred: ${e.occurredAt}\n` +
      `Confidence: ${report.confidence}\n` +
      `Action: ${report.suggestedRemediation[0]}`
    );
  } catch (err) {
    console.error('Failed to post drift alert:', err.message);
  }
}

const parity = attach(client, {
  strategies: [{ send: postDriftAlert }],
});

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log('Parity drift detection is active.');
});

// Example: kick a member safely through Parity.
// Before calling Discord, record what you are about to do.
// If the audit log later shows the action came from somewhere else, drift fires.
async function kickMember(guild, memberId, reason) {
  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) throw new Error('Member not found');

  await parity.intent({
    actionType: 'MEMBER_KICK',
    targetId: memberId,
    targetType: 'member',
    guildId: guild.id,
  });

  await member.kick(reason);
}

// Example: ban a member safely through Parity.
async function banMember(guild, memberId, reason) {
  await parity.intent({
    actionType: 'MEMBER_BAN_ADD',
    targetId: memberId,
    targetType: 'user',
    guildId: guild.id,
  });

  await guild.bans.create(memberId, { reason });
}

// Example: update a channel topic safely through Parity.
// Use the normalized actionType and lowercase targetType that discord.js delivers.
async function setChannelTopic(channel, topic) {
  await parity.intent({
    actionType: 'CHANNEL_UPDATE',
    targetId: channel.id,
    targetType: 'channel',
    guildId: channel.guild.id,
  });

  await channel.setTopic(topic);
}

// Simple !commands for demonstration.
// In production use slash commands instead (no MessageContent privileged intent needed).
client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith('!parity')) return;

  const me = message.guild.members.me;
  const [, sub, ...rest] = message.content.split(' ');

  if (sub === 'status') {
    await message.reply(
      `Parity v1.0.1 is active.\n` +
      `Monitoring guild ${message.guild.name}.\n` +
      `Alert channel: ${alertChannelId ? `<#${alertChannelId}>` : 'not configured'}`
    );
    return;
  }

  if (sub === 'settopic' && rest.length) {
    if (!me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      await message.reply('Missing ManageChannels permission.');
      return;
    }
    try {
      await setChannelTopic(message.channel, rest.join(' '));
      await message.reply(`Topic updated. Parity intent was recorded before the API call.`);
    } catch (err) {
      await message.reply(`Error: ${err.message}`);
    }
    return;
  }

  await message.reply(
    'Commands: `!parity status` | `!parity settopic <text>`'
  );
});

client.on(Events.Error, err => {
  console.error('Discord client error:', err.message);
});

process.on('SIGINT', () => {
  parity.detach();
  client.destroy();
  process.exit(0);
});

client.login(token);
