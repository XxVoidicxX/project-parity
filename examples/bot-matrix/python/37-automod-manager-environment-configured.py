import asyncio
import sys
from pathlib import Path

import discord

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'parity-py'))

from parity_py import attach

PROFILE = {
  "id": "python-37-automod-manager-environment-configured",
  "language": "python",
  "family": "automod-manager",
  "shape": "environment-configured",
  "integration": "intent",
  "actionType": "AUTO_MODERATION_RULE_UPDATE",
  "targetType": "auto-moderation-rule"
}

def create_baseline_bot():
    intents = discord.Intents.none()
    intents.guilds = True
    intents.moderation = True
    intents.guild_messages = True
    return discord.Client(intents=intents)

async def create_parity_bot(**options):
    client = create_baseline_bot()
    parity = await attach(client, runtime=False, **options)
    return {'client': client, 'parity': parity, 'profile': PROFILE}

async def run_action(context, parity=None):
    if parity is None:
        return await context['perform']()
    if PROFILE['integration'] == 'track':
        return await parity['track'](context['intent_for'], context['perform'])
    await parity['intent']({'actionType': PROFILE['actionType'], 'targetId': str(context['targetId']), 'targetType': PROFILE['targetType'], 'guildId': str(context['guildId'])})
    return await context['perform']()

async def start_bot(token, **options):
    bot = await create_parity_bot(**options)
    await bot['client'].start(token)
    return bot
