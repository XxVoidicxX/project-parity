import asyncio
import os
import sys
from pathlib import Path

import discord

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'parity-py'))

from parity_py import attach
from parity_py.doctor import run_onboarding_doctor


def load_env():
    path = ROOT / '.env'
    if not path.exists(): return
    for line in path.read_text(encoding='utf-8').splitlines():
        if '=' not in line: continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"\''))


load_env()
TOKEN = os.getenv('DISCORD_BOT_TOKEN')
GUILD_ID = os.getenv('PARITY_GUILD_ID')
if not TOKEN or not GUILD_ID:
    print('Set DISCORD_BOT_TOKEN and PARITY_GUILD_ID to run the Python live doctor test.')
    raise SystemExit(0)


class DoctorClient(discord.Client):
    def __init__(self):
        intents = discord.Intents.none()
        intents.guilds = True
        intents.guild_messages = True
        intents.moderation = True
        super().__init__(intents=intents)
        self.results, self.parity, self.channel, self.started = [], None, None, False
    def record(self, name, passed, detail):
        self.results.append((name, passed, detail))
        print(f"{'PASS' if passed else 'FAIL'} {name}: {detail}")
    async def close(self):
        session = getattr(self.http, '_HTTPClient__session', None)
        if session is not None and not session.closed:
            await session.close()
        await super().close()
    async def on_ready(self):
        if self.started: return
        self.started = True
        try:
            guild = self.get_guild(int(GUILD_ID)) or await self.fetch_guild(int(GUILD_ID))
            me = guild.me or await guild.fetch_member(self.user.id)
            overwrites = {guild.default_role: discord.PermissionOverwrite(view_channel=False), me: discord.PermissionOverwrite(view_channel=True, send_messages=True)}
            self.channel = await guild.create_text_channel(f'parity-py-doctor-{str(asyncio.get_running_loop().time()).replace(".", "")[-6:]}', overwrites=overwrites, reason='parity Python live doctor test')
            self.parity = await attach(self, alert_channel_id=str(self.channel.id))
            doctor = await run_onboarding_doctor(self, self.parity, GUILD_ID, str(self.channel.id), send_test=True)
            for check in doctor['checks']: self.record(check['name'], check['pass'], check['detail'])
            message = doctor.get('test_message')
            flags = getattr(getattr(message, 'flags', None), 'value', getattr(message, 'flags', 0))
            components = getattr(message, 'components', ())
            first_type = components[0].get('type') if components and isinstance(components[0], dict) else getattr(components[0], 'type', None) if components else None
            self.record('Components V2 alert card', bool(flags & 32768) and len(components) == 1 and first_type == 17, 'Expected a Components V2 Container with tracked text displays.')
        except Exception as error:
            self.record('live Python doctor completed', False, f'{type(error).__name__}: {error}')
        finally:
            if self.parity: await self.parity['detach']()
            if self.channel:
                try: await self.channel.delete(reason='parity Python doctor test cleanup')
                except Exception as error: self.record('cleanup', False, str(error))
            await self.close()


async def main():
    client = DoctorClient()
    async with client:
        await client.start(TOKEN)
    passed = sum(result[1] for result in client.results)
    print(f'{passed}/{len(client.results)} passed')
    return 0 if all(result[1] for result in client.results) else 1


if __name__ == '__main__': raise SystemExit(asyncio.run(main()))
