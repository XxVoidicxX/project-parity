"""
Example discord.py bot with Project Parity drift detection integrated.

Install:
    pip install discord.py python-dotenv
    cp .env.example .env   # then fill in your token

Run:
    python bot.py

The bot needs these intents enabled in the Discord Developer Portal:
  - GUILD_AUDIT_LOG (under Privileged Gateway Intents)
  - MESSAGE_CONTENT (if you want the !parity commands to work)
"""

import asyncio
import os
import sys
from pathlib import Path

# Resolve parity-py relative to this file's location in examples/discord-bot-py
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'parity-py'))

import discord
from dotenv import load_dotenv
from parity_py import Ledger, Reconciler, AlertDispatcher, AuditListener

load_dotenv()

TOKEN = os.getenv('DISCORD_BOT_TOKEN')
ALERT_CHANNEL_ID = os.getenv('PARITY_ALERT_CHANNEL_ID')

if not TOKEN:
    sys.exit('Set DISCORD_BOT_TOKEN in .env or the environment.')


class ParityStrategy:
    def __init__(self, bot_ref):
        self.bot = bot_ref

    async def send(self, report):
        event = report['event']
        print(f'[PARITY DRIFT] {event["actionType"]} on {event["targetId"]} in {event["guildId"]} '
              f'(confidence={report["confidence"]})')

        if not ALERT_CHANNEL_ID:
            return
        channel = self.bot.get_channel(int(ALERT_CHANNEL_ID))
        if not channel:
            return
        await channel.send(
            f'**DRIFT DETECTED** - token may be in use by another process\n'
            f'Action: `{event["actionType"]}`  Target: `{event["targetId"]}`  Guild: `{event["guildId"]}`\n'
            f'Occurred: {event["occurredAt"]}\n'
            f'Confidence: {report["confidence"]}\n'
            f'Action: {report["suggestedRemediation"][0]}'
        )


class ParityBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guild_audit_log = True
        intents.message_content = True
        super().__init__(intents=intents)

        self.ledger = Ledger()
        self.dispatcher = AlertDispatcher(strategies=[])
        self.reconciler = Reconciler(self.ledger)
        self.parity_listener = None

    async def setup_hook(self):
        strategy = ParityStrategy(self)
        self.dispatcher = AlertDispatcher(strategies=[strategy])
        self.reconciler = Reconciler(self.ledger)
        self.parity_listener = AuditListener(
            client=self,
            reconciler=self.reconciler,
            dispatcher=self.dispatcher,
            bot_user_id=lambda: self.user.id if self.user else None,
        )

    async def on_ready(self):
        print(f'Logged in as {self.user} (id={self.user.id})')
        print('Parity drift detection is active.')

    async def on_audit_log_entry_create(self, entry: discord.AuditLogEntry):
        raw = {
            'id': str(entry.id),
            'action': entry.action.value,
            'targetId': str(entry.target.id) if entry.target else 'unknown',
            'targetType': type(entry.target).__name__.lower() if entry.target else 'unknown',
            'guildId': str(entry.guild.id),
            'executorId': str(entry.user.id) if entry.user else '',
            'createdTimestamp': int(entry.created_at.timestamp() * 1000),
            'count': getattr(entry.extra, 'count', 1) or 1,
        }
        await self.parity_listener.handle_audit(raw)

    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return
        if message.author == self.user:
            await self.parity_listener.handle_message({
                'id': str(message.id),
                'guildId': str(message.guild.id),
                'author': {'id': str(message.author.id)},
                'createdTimestamp': int(message.created_at.timestamp() * 1000),
            })
        if not message.content.startswith('!parity'):
            return

        parts = message.content.split()
        sub = parts[1] if len(parts) > 1 else ''

        if sub == 'status':
            await message.reply(
                f'Parity v1.0.1 is active.\n'
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
        await self.ledger.record({
            'actionType': 'CHANNEL_UPDATE',
            'targetId': str(channel.id),
            'targetType': 'channel',
            'guildId': str(channel.guild.id),
        })
        await channel.edit(topic=topic)

    async def kick_member(self, guild: discord.Guild, member_id: int, reason: str = ''):
        await self.ledger.record({
            'actionType': 'MEMBER_KICK',
            'targetId': str(member_id),
            'targetType': 'member',
            'guildId': str(guild.id),
        })
        await guild.kick(discord.Object(id=member_id), reason=reason)

    async def ban_member(self, guild: discord.Guild, member_id: int, reason: str = ''):
        await self.ledger.record({
            'actionType': 'MEMBER_BAN_ADD',
            'targetId': str(member_id),
            'targetType': 'user',
            'guildId': str(guild.id),
        })
        await guild.ban(discord.Object(id=member_id), reason=reason)


bot = ParityBot()
bot.run(TOKEN)
