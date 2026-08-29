import asyncio
import os
import sys
import time
import traceback
from pathlib import Path

import discord

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'parity-py'))

from parity_py import attach


def load_env():
    path = ROOT / '.env'
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        if '=' not in line or line.lstrip().startswith('#'):
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"\''))


load_env()
TOKEN = os.getenv('DISCORD_BOT_TOKEN')
GUILD_ID = os.getenv('PARITY_GUILD_ID')
if not TOKEN or not GUILD_ID:
    print('Set DISCORD_BOT_TOKEN and PARITY_GUILD_ID to run the Python live test.')
    raise SystemExit(0)


class Collector:
    def __init__(self):
        self.reports = []

    async def send(self, report):
        self.reports.append(report)
        event = report['event']
        print(f"  drift {event['actionType']} target={event['targetId']}")


class LiveClient(discord.Client):
    def __init__(self):
        intents = discord.Intents.none()
        intents.guilds = True
        intents.guild_messages = True
        intents.moderation = True
        super().__init__(intents=intents)
        self.collector = Collector()
        self.parity = None
        self.started = False
        self.results = []
        self.raw_shapes = []

    async def ensure_parity(self):
        if self.parity is None:
            self.parity = await attach(self, strategies=[self.collector])

    async def close(self):
        session = getattr(self.http, '_HTTPClient__session', None)
        if session is not None and not session.closed:
            await session.close()
        await super().close()

    async def setup_hook(self):
        await self.ensure_parity()

    async def on_ready(self):
        if self.started:
            return
        await self.ensure_parity()
        self.started = True
        asyncio.create_task(self.run_checks())

    async def on_error(self, event_method, *args, **kwargs):
        print(f'Unhandled discord.py listener error in {event_method}:')
        traceback.print_exc()

    async def on_audit_log_entry_create(self, entry):
        self.raw_shapes.append({
            'action': entry.action.value,
            'targetType': type(entry.target).__name__ if entry.target else None,
        })

    def record(self, name, passed, detail=''):
        self.results.append((name, passed, detail))
        print(f"  {'PASS' if passed else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")

    async def find_report(self, action_type, target_id, start, timeout=20):
        end = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < end:
            for report in self.collector.reports[start:]:
                event = report['event']
                if event['actionType'] == action_type and str(event['targetId']) == str(target_id):
                    return report
            await asyncio.sleep(0.5)
        return None

    async def run_checks(self):
        channel = None
        try:
            print(f'Connected as {self.user} ({self.user.id})')
            guild = self.get_guild(int(GUILD_ID)) or await self.fetch_guild(int(GUILD_ID))

            before = len(self.collector.reports)
            channel = await guild.create_text_channel(f'parity-py-test-{str(time.time_ns())[-6:]}', topic='parity init', reason='parity Python live test')
            create_report = await self.find_report('CHANNEL_CREATE', channel.id, before)
            self.record('unrecorded channel create is drift', create_report is not None)

            before = len(self.collector.reports)
            await channel.edit(topic='rogue Python update', reason='parity Python live test')
            update_report = await self.find_report('CHANNEL_UPDATE', channel.id, before)
            self.record('unrecorded channel update is drift', update_report is not None)

            before = len(self.collector.reports)
            await self.parity['intent']({
                'actionType': 'CHANNEL_UPDATE', 'targetId': str(channel.id),
                'targetType': 'channel', 'guildId': GUILD_ID,
            })
            await channel.edit(topic='recorded Python update', reason='parity Python live test')
            false_update = await self.find_report('CHANNEL_UPDATE', channel.id, before, timeout=12)
            self.record('recorded channel update reconciles', false_update is None, 'FALSE POSITIVE' if false_update else '')

            before = len(self.collector.reports)
            rogue_message = await channel.send('parity Python unrecorded self-message')
            message_report = await self.find_report('MESSAGE_CREATE', rogue_message.id, before, timeout=15)
            self.record('unrecorded self-message is drift', message_report is not None)

            before = len(self.collector.reports)
            tracked_message = await self.parity['track'](
                lambda message: {
                    'actionType': 'MESSAGE_CREATE', 'targetId': str(message.id),
                    'targetType': 'message', 'guildId': GUILD_ID,
                },
                lambda: channel.send('parity Python tracked self-message'),
            )
            false_message = await self.find_report('MESSAGE_CREATE', tracked_message.id, before, timeout=15)
            self.record('result-derived tracked self-message reconciles', false_message is None, 'FALSE POSITIVE' if false_message else '')
        except Exception as error:
            traceback.print_exc()
            self.record('Python live harness completed', False, f'{type(error).__name__}: {error}')
        finally:
            if self.parity:
                await self.parity['detach']()
            if channel:
                try:
                    await channel.delete(reason='parity Python live test cleanup')
                    print(f'  deleted channel {channel.name}')
                except Exception as error:
                    self.record('temporary channel cleanup', False, str(error))
            await self.close()


async def main():
    client = LiveClient()
    async with client:
        await client.start(TOKEN)
    print('\n========== PYTHON LIVE TEST SUMMARY ==========')
    for name, passed, detail in client.results:
        print(f"  {'[PASS]' if passed else '[FAIL]'} {name}{f'  -  {detail}' if detail else ''}")
    passed = sum(result[1] for result in client.results)
    print(f'\n{passed}/{len(client.results)} passed')
    unique_shapes = sorted({(shape['action'], shape['targetType']) for shape in client.raw_shapes})
    print('Observed discord.py audit shapes:', unique_shapes)
    return 1 if any(not result[1] for result in client.results) else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
