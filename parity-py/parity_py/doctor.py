import argparse
import asyncio
import os

from . import attach


def _permission(permissions, name):
    return bool(getattr(permissions, {'ViewAuditLog': 'view_audit_log', 'ViewChannel': 'view_channel', 'SendMessages': 'send_messages'}[name], False))


async def inspect_onboarding(client, guild_id, alert_channel_id, alert_user_id=None):
    checks = []
    def add(name, passed, detail): checks.append({'name': name, 'pass': passed, 'detail': detail})
    if getattr(getattr(client, 'user', None), 'id', None) is None:
        add('Discord connection', False, 'The client is not logged in.')
        return {'ok': False, 'checks': checks}
    add('Discord connection', True, f'Logged in as {client.user.id}.')
    if not guild_id: add('Guild configuration', False, 'Set PARITY_GUILD_ID.')
    if not alert_channel_id: add('Alert channel configuration', False, 'Set PARITY_ALERT_CHANNEL_ID.')
    if not guild_id or not alert_channel_id: return {'ok': False, 'checks': checks}
    try:
        guild = client.get_guild(int(guild_id)) or await client.fetch_guild(int(guild_id))
        me = guild.me or await guild.fetch_member(client.user.id)
        add('Guild access', True, f'Connected to {guild.id}.')
    except Exception as error:
        add('Guild access', False, str(error))
        return {'ok': False, 'checks': checks}
    add('Audit-log permission', _permission(me.guild_permissions, 'ViewAuditLog'), 'ViewAuditLog is granted.' if _permission(me.guild_permissions, 'ViewAuditLog') else 'Grant ViewAuditLog to the bot.')
    try:
        channel = client.get_channel(int(alert_channel_id)) or await client.fetch_channel(int(alert_channel_id))
    except Exception as error:
        add('Alert channel access', False, str(error))
        return {'ok': False, 'checks': checks}
    bot_permissions = channel.permissions_for(me) if callable(getattr(channel, 'permissions_for', None)) else None
    can_send = _permission(bot_permissions, 'ViewChannel') and _permission(bot_permissions, 'SendMessages')
    add('Alert channel type', callable(getattr(channel, 'send', None)), 'The alert destination is text-based.' if callable(getattr(channel, 'send', None)) else 'Configure a guild text channel.')
    add('Alert channel permissions', can_send, 'The bot can view and send alerts.' if can_send else 'Grant ViewChannel and SendMessages to the bot.')
    everyone_permissions = channel.permissions_for(guild.default_role) if callable(getattr(channel, 'permissions_for', None)) else None
    private = not _permission(everyone_permissions, 'ViewChannel')
    add('Alert channel privacy', private, 'The @everyone role cannot view alerts.' if private else 'Remove ViewChannel from @everyone or choose a private channel.')
    if alert_user_id:
        try:
            owner = guild.get_member(int(alert_user_id)) or await guild.fetch_member(int(alert_user_id))
            visible = _permission(channel.permissions_for(owner), 'ViewChannel')
            add('Owner visibility', visible, 'The configured owner can view alerts.' if visible else 'Grant ViewChannel to the configured owner.')
        except Exception as error:
            add('Owner visibility', False, str(error))
    else:
        add('Owner visibility', True, 'No owner mention is configured.')
    return {'ok': all(check['pass'] for check in checks), 'checks': checks}


async def run_onboarding_doctor(client, parity, guild_id, alert_channel_id, alert_user_id=None, send_test=False, timeout_ms=15000):
    inspection = await inspect_onboarding(client, guild_id, alert_channel_id, alert_user_id)
    if not send_test or not inspection['ok']:
        return inspection
    checks = [*inspection['checks']]
    test_message = None
    try:
        message = test_message = await parity['test_owner_alert']()
        end = asyncio.get_running_loop().time() + timeout_ms / 1000
        matched = False
        while asyncio.get_running_loop().time() < end:
            matched = any(record['phase'] == 'discord-matched' and record.get('transport') == 'message' and record['event']['targetId'] == str(message.id) for record in parity['journal'].entries())
            if matched: break
            await asyncio.sleep(0.1)
        checks.append({'name': 'Tracked test alert', 'pass': matched, 'detail': f'Test message {message.id} was delivered and reconciled.' if matched else 'The test message did not reconcile before the timeout.'})
    except Exception as error:
        checks.append({'name': 'Tracked test alert', 'pass': False, 'detail': str(error)})
    return {'ok': all(check['pass'] for check in checks), 'checks': checks, 'test_message': test_message}


async def _main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--send-test', action='store_true')
    args = parser.parse_args()
    token = os.getenv('DISCORD_BOT_TOKEN')
    guild_id = os.getenv('PARITY_GUILD_ID')
    alert_channel_id = os.getenv('PARITY_ALERT_CHANNEL_ID')
    alert_user_id = os.getenv('PARITY_ALERT_USER_ID')
    if not token or not guild_id or not alert_channel_id:
        raise SystemExit('Set DISCORD_BOT_TOKEN, PARITY_GUILD_ID, and PARITY_ALERT_CHANNEL_ID.')
    import discord
    class DoctorClient(discord.Client):
        def __init__(self):
            intents = discord.Intents.none()
            intents.guilds = True
            intents.guild_messages = True
            intents.moderation = True
            super().__init__(intents=intents)
            self.parity = None
            self.finished = False
            self.exit_code = 1
        async def close(self):
            session = getattr(self.http, '_HTTPClient__session', None)
            if session is not None and not session.closed:
                await session.close()
            await super().close()
        async def ensure_parity(self):
            if self.parity is None:
                self.parity = await attach(self, alert_channel_id=alert_channel_id, alert_user_id=alert_user_id)
        async def setup_hook(self): await self.ensure_parity()
        async def on_ready(self):
            if self.finished: return
            self.finished = True
            await self.ensure_parity()
            result = await run_onboarding_doctor(self, self.parity, guild_id, alert_channel_id, alert_user_id, args.send_test)
            for check in result['checks']: print(f"{'PASS' if check['pass'] else 'FAIL'} {check['name']}: {check['detail']}")
            self.exit_code = 0 if result['ok'] else 1
            await self.parity['detach']()
            await self.close()
    client = DoctorClient()
    async with client:
        await client.start(token)
    return client.exit_code


def main(): return asyncio.run(_main())


if __name__ == '__main__': raise SystemExit(main())
