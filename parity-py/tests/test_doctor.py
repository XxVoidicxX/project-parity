import unittest

from parity_py.doctor import inspect_onboarding, run_onboarding_doctor


class Permissions:
    def __init__(self, names):
        self.view_audit_log = 'ViewAuditLog' in names
        self.view_channel = 'ViewChannel' in names
        self.send_messages = 'SendMessages' in names


def developer_bot(audit=True, send=True, public_channel=False, owner_visible=True):
    bot = type('Member', (), {'id': 1, 'guild_permissions': Permissions(['ViewAuditLog'] if audit else [])})()
    owner = type('Member', (), {'id': 2})()
    everyone = type('Role', (), {'id': 3})()
    class Channel:
        async def send(self, content): return type('Message', (), {'id': 9})()
        def permissions_for(self, subject):
            if subject is bot: return Permissions(['ViewChannel', *(['SendMessages'] if send else [])])
            if subject is everyone: return Permissions(['ViewChannel'] if public_channel else [])
            if subject is owner: return Permissions(['ViewChannel'] if owner_visible else [])
            return Permissions([])
    channel = Channel()
    class Guild:
        id = 4
        me = bot
        default_role = everyone
        def get_member(self, member_id): return owner if member_id == 2 else bot
        async def fetch_member(self, member_id): return self.get_member(member_id)
    guild = Guild()
    class Client:
        user = type('User', (), {'id': 1})()
        def get_guild(self, guild_id): return guild
        async def fetch_guild(self, guild_id): return guild
        def get_channel(self, channel_id): return channel
        async def fetch_channel(self, channel_id): return channel
    return Client()


class DoctorTests(unittest.IsolatedAsyncioTestCase):
    async def test_doctor_approves_a_private_alert_capable_developer_bot(self):
        result = await inspect_onboarding(developer_bot(), '4', '5', '2')
        self.assertTrue(result['ok'])
        self.assertTrue(all(check['pass'] for check in result['checks']))

    async def test_doctor_rejects_public_alert_channel_and_missing_send_permission(self):
        result = await inspect_onboarding(developer_bot(public_channel=True), '4', '5')
        self.assertFalse(result['ok'])
        self.assertFalse(next(check for check in result['checks'] if check['name'] == 'Alert channel privacy')['pass'])
        result = await inspect_onboarding(developer_bot(send=False), '4', '5')
        self.assertFalse(result['ok'])
        self.assertFalse(next(check for check in result['checks'] if check['name'] == 'Alert channel permissions')['pass'])

    async def test_doctor_confirms_a_tracked_test_alert(self):
        async def test_owner_alert(): return type('Message', (), {'id': 9})()
        parity = {'test_owner_alert': test_owner_alert, 'journal': type('Journal', (), {'entries': lambda self: [{'phase': 'discord-matched', 'transport': 'message', 'event': {'targetId': '9'}}]})()}
        result = await run_onboarding_doctor(developer_bot(), parity, '4', '5', send_test=True)
        self.assertTrue(result['ok'])
        self.assertTrue(next(check for check in result['checks'] if check['name'] == 'Tracked test alert')['pass'])
