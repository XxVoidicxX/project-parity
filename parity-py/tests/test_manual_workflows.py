import unittest

from parity_py import Ledger, Reconciler, attach

NOW = 1788004800000

def intent(**overrides):
    return {'actionType': 'CHANNEL_CREATE', 'targetId': 'target', 'targetType': 'channel', 'guildId': 'guild', 'correlationId': 'intent-1', **overrides}

def event(**overrides):
    return {'actionType': 'CHANNEL_CREATE', 'targetId': 'target', 'targetType': 'channel', 'guildId': 'guild', 'executorId': 'bot', 'auditEntryId': 'audit-1', 'occurredAt': '2026-08-29T12:00:00.000Z', 'count': 1, **overrides}

class ManualWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_manual_channel_delete_intent_reconciles(self):
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(actionType='CHANNEL_DELETE', targetId='channel', targetType='channel'))
        self.assertIsNone(await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType='CHANNEL_DELETE', targetId='channel', targetType='channel')))

    async def test_manual_role_update_intent_reconciles(self):
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(actionType='ROLE_UPDATE', targetId='role', targetType='role'))
        self.assertIsNone(await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType='ROLE_UPDATE', targetId='role', targetType='role')))

    async def test_result_derived_track_records_a_generated_channel_id(self):
        parity = await attach(None, clock=lambda: NOW, runtime=False)
        result = await parity['track'](lambda channel: intent(targetId=channel['id'], correlationId='generated-channel'), lambda: {'id': 'generated-channel'})
        self.assertEqual(result, {'id': 'generated-channel'})
        self.assertEqual((await parity['ledger'].entries())[0]['targetId'], 'generated-channel')
        await parity['detach']()

    async def test_pre_call_track_removes_an_intent_after_rejection(self):
        parity = await attach(None, clock=lambda: NOW, runtime=False)
        async def rejected(): raise RuntimeError('Discord rejected update')
        with self.assertRaisesRegex(RuntimeError, 'Discord rejected update'):
            await parity['track'](intent(correlationId='rejected-update'), rejected)
        self.assertEqual(await parity['ledger'].entries(), [])
        await parity['detach']()

    async def test_result_derived_message_track_reconciles_a_self_message(self):
        parity = await attach(None, clock=lambda: NOW, runtime=False, bot_user_id=lambda: 'bot')
        await parity['track'](lambda message: {'actionType': 'MESSAGE_CREATE', 'targetId': message['id'], 'targetType': 'message', 'guildId': 'guild', 'correlationId': 'tracked-message'}, lambda: {'id': 'tracked-message'})
        report = await parity['listener'].handle_message({'id': 'tracked-message', 'guildId': 'guild', 'author': {'id': 'bot'}, 'createdTimestamp': NOW})
        self.assertIsNone(report)
        self.assertEqual(await parity['ledger'].entries(), [])
        await parity['detach']()

    async def test_manual_intents_remain_isolated_by_guild(self):
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(guildId='guild-a', correlationId='guild-a'))
        report = await Reconciler(ledger, clock=lambda: NOW).reconcile(event(guildId='guild-b'))
        self.assertEqual(report['ledger']['state'], 'none')

if __name__ == '__main__': unittest.main()
