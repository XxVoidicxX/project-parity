import asyncio
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'parity-py'))

import discord
from dotenv import load_dotenv
from parity_py import attach

load_dotenv()

TOKEN = os.getenv('DISCORD_BOT_TOKEN')
ALERT_CHANNEL_ID = os.getenv('PARITY_ALERT_CHANNEL_ID')
ALERT_USER_ID = os.getenv('PARITY_ALERT_USER_ID')

if not TOKEN:
    sys.exit('Set DISCORD_BOT_TOKEN in .env or the environment.')


class ParityBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.moderation = True
        intents.message_content = True
        super().__init__(intents=intents)

        self.parity = None

    async def setup_hook(self):
        self.parity = await attach(self, alert_channel_id=ALERT_CHANNEL_ID, alert_user_id=ALERT_USER_ID)

    async def on_ready(self):
        print(f'Logged in as {self.user} (id={self.user.id})')
        print('Parity drift detection is active.')

    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return
        if not message.content.startswith('!parity'):
            return

        parts = message.content.split()
        sub = parts[1] if len(parts) > 1 else ''

        if sub == 'status':
            await message.reply(
                f'Parity v1.3.0 is active.\n'
                f'Monitoring guild {message.guild.name}.\n'
                f'Alert channel: {f"<#{ALERT_CHANNEL_ID}>" if ALERT_CHANNEL_ID else "not configured"}'
            )
            return

        if sub == 'settopic' and len(parts) > 2:
            topic = ' '.join(parts[2:])
            if not isinstance(message.channel, discord.TextChannel):
                await message.reply('Can only set topic on text channels.')
                return
            await self.set_channel_topic(message.channel, topic)
            await message.reply('Topic updated. Parity intent was recorded before the API call.')
            return

        await message.reply('Commands: `!parity status` | `!parity settopic <text>`')

    async def set_channel_topic(self, channel: discord.TextChannel, topic: str):
        await self.parity['intent']({
            'actionType': 'CHANNEL_UPDATE',
            'targetId': str(channel.id),
            'targetType': 'channel',
            'guildId': str(channel.guild.id),
        })
        await channel.edit(topic=topic)

    async def kick_member(self, guild: discord.Guild, member_id: int, reason: str = ''):
        await self.parity['intent']({
            'actionType': 'MEMBER_KICK',
            'targetId': str(member_id),
            'targetType': 'user',
            'guildId': str(guild.id),
        })
        await guild.kick(discord.Object(id=member_id), reason=reason)

    async def ban_member(self, guild: discord.Guild, member_id: int, reason: str = ''):
        await self.parity['intent']({
            'actionType': 'MEMBER_BAN_ADD',
            'targetId': str(member_id),
            'targetType': 'user',
            'guildId': str(guild.id),
        })
        await guild.ban(discord.Object(id=member_id), reason=reason)


bot = ParityBot()
bot.run(TOKEN)
