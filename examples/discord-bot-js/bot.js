import 'dotenv/config';
import { Client, GatewayIntentBits, Events, PermissionsBitField } from 'discord.js';
import { attach } from '../../parity-js/src/index.js';

const token = process.env.DISCORD_BOT_TOKEN;
const alertChannelId = process.env.PARITY_ALERT_CHANNEL_ID;
const alertUserId = process.env.PARITY_ALERT_USER_ID;

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

const parity = attach(client, {
  alertChannelId,
  alertUserId,
});

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log('Parity drift detection is active.');
});

async function kickMember(guild, memberId, reason) {
  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) throw new Error('Member not found');

  await parity.intent({
    actionType: 'MEMBER_KICK',
    targetId: memberId,
    targetType: 'user',
    guildId: guild.id,
  });

  await member.kick(reason);
}

async function banMember(guild, memberId, reason) {
  await parity.intent({
    actionType: 'MEMBER_BAN_ADD',
    targetId: memberId,
    targetType: 'user',
    guildId: guild.id,
  });

  await guild.bans.create(memberId, { reason });
}

async function setChannelTopic(channel, topic) {
  await parity.intent({
    actionType: 'CHANNEL_UPDATE',
    targetId: channel.id,
    targetType: 'channel',
    guildId: channel.guild.id,
  });

  await channel.setTopic(topic);
}

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith('!parity')) return;

  const me = message.guild.members.me;
  const [, sub, ...rest] = message.content.split(' ');

  if (sub === 'status') {
    await message.reply(
      `Parity v1.3.0 is active.\n` +
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
