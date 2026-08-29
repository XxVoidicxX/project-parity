import asyncio
import unittest
from datetime import datetime, timezone

from parity_py import attach, AlertDispatcher, AuditListener, Ledger, Reconciler, SqliteLedgerAdapter, _discord_py_entry_to_dict, _target_type_for_action

NOW = 1786104000000

def intent(**overrides):
    return {'actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild','correlationId':'intent-1'} | overrides

def event(**overrides):
    return {'actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild','executorId':'bot','auditEntryId':'audit-1','occurredAt':'2026-08-07T12:00:00.000Z','count':1} | overrides

class Collector:
    def __init__(self, reports): self.reports = reports
    async def send(self, report): self.reports.append(report)

class Tests(unittest.IsolatedAsyncioTestCase):
    def test_action_derived_target_types_match_discord_js(self):
        expected = {
            'CHANNEL_OVERWRITE_UPDATE': 'overwrite',
            'MEMBER_KICK': 'user',
            'APPLICATION_COMMAND_PERMISSION_UPDATE': 'applicationcommand',
            'AUTO_MODERATION_RULE_UPDATE': 'automoderation',
            'ONBOARDING_PROMPT_UPDATE': 'guildonboardingprompt',
            'ONBOARDING_UPDATE': 'guild',
            'MESSAGE_BULK_DELETE': 'channel',
            'MEMBER_DISCONNECT': 'guild',
        }
        self.assertEqual({action: _target_type_for_action(action) for action in expected}, expected)

    async def test_attach_registers_live_handlers_detaches_and_tracks_safely(self):
        class Client:
            def __init__(self):
                self.user = type('User', (), {'id': 'bot'})()
                self.listeners = {}
            def add_listener(self, handler, name): self.listeners[name] = handler
            def remove_listener(self, handler, name):
                if self.listeners.get(name) is handler: self.listeners.pop(name)

        reports = []
        client = Client()
        parity = await attach(client, clock=lambda: NOW, strategies=[Collector(reports)])
        self.assertEqual(set(client.listeners), {'on_audit_log_entry_create', 'on_audit_log_entry', 'on_raw_audit_log_entry', 'on_message'})
        await parity['intent'](intent())
        action = type('Action', (), {'value': 10})()
        actor = type('User', (), {'id': 'bot'})()
        guild = type('Guild', (), {'id': 'guild'})()
        entry = type('Entry', (), {'id': 'audit', 'action': action, 'target': type('Channel', (), {'id': 'target'})(), 'user': actor, 'user_id': 'bot', 'guild': guild, 'created_at': datetime.fromtimestamp(NOW / 1000, timezone.utc), 'extra': None})()
        await client.listeners['on_audit_log_entry_create'](entry)
        self.assertEqual(await parity['ledger'].entries(), [])
        message = type('Message', (), {'id': 'rogue-message', 'author': actor, 'guild': guild, 'created_at': datetime.fromtimestamp(NOW / 1000, timezone.utc)})()
        await client.listeners['on_message'](message)
        self.assertEqual(reports[0]['event']['actionType'], 'MESSAGE_CREATE')

        async def rejected(): raise RuntimeError('REST rejected')
        with self.assertRaisesRegex(RuntimeError, 'REST rejected'):
            await parity['track'](intent(correlationId='failed-track'), rejected)
        self.assertEqual(await parity['ledger'].entries(), [])
        result = await parity['track'](lambda resource: intent(targetId=resource['id'], correlationId='generated-target'), lambda: {'id': 'discord-id'})
        self.assertEqual(result['id'], 'discord-id')
        self.assertEqual((await parity['ledger'].entries())[0]['targetId'], 'discord-id')
        await parity['ledger'].remove('generated-target')

        gate = asyncio.Event()
        async def generated_message():
            await gate.wait()
            return {'id': 'tracked-message'}
        tracked = asyncio.create_task(parity['track'](
            lambda resource: {'actionType': 'MESSAGE_CREATE', 'targetId': resource['id'], 'targetType': 'message', 'guildId': 'guild', 'correlationId': 'tracked-message'},
            generated_message,
        ))
        await asyncio.sleep(0)
        tracked_message = type('Message', (), {'id': 'tracked-message', 'author': actor, 'guild': guild, 'created_at': datetime.fromtimestamp(NOW / 1000, timezone.utc)})()
        gateway = asyncio.create_task(client.listeners['on_message'](tracked_message))
        gate.set()
        await asyncio.gather(tracked, gateway)
        self.assertEqual(len(reports), 1)
        self.assertEqual(await parity['ledger'].entries(), [])
        await parity['detach']()
        self.assertEqual(client.listeners, {})

    async def test_attach_composes_plain_discord_client_handlers_without_add_listener(self):
        calls = []
        class PlainClient:
            def __init__(self): self.user = type('User', (), {'id': 'bot'})()
            async def on_message(self, message): calls.append(('host', message.id))

        client = PlainClient()
        original = client.on_message
        reports = []
        parity = await attach(client, clock=lambda: NOW, strategies=[Collector(reports)])
        self.assertIsNot(client.on_message, original)
        message = type('Message', (), {
            'id': 'rogue', 'author': type('User', (), {'id': 'bot'})(),
            'guild': type('Guild', (), {'id': 'guild'})(),
            'created_at': datetime.fromtimestamp(NOW / 1000, timezone.utc),
        })()
        await client.on_message(message)
        self.assertEqual(calls, [('host', 'rogue')])
        self.assertEqual(reports[0]['event']['actionType'], 'MESSAGE_CREATE')
        await parity['detach']()
        self.assertEqual(client.on_message, original)

    async def test_ledger_writes_canonical_entry_and_purge_timing_edges(self):
        ledger = Ledger(clock=lambda: NOW)
        entry = await ledger.record(intent(correlationId='generated'))
        self.assertEqual(entry['expiresAt'], '2026-08-07T12:02:00.000Z')
        await ledger.purge(NOW + 240000)
        self.assertEqual(len(await ledger.entries()), 1)
        await ledger.purge(NOW + 240001)
        self.assertEqual(len(await ledger.entries()), 0)

    async def test_bulk_message_delete_requires_one_exact_counted_intent(self):
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(actionType='MESSAGE_BULK_DELETE', targetId='channel', targetType='channel', count=3))
        self.assertIsNone(await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType='MESSAGE_BULK_DELETE', targetId='channel', targetType='channel', count=3)))
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(actionType='MESSAGE_BULK_DELETE', targetId='channel', targetType='channel', count=2))
        report = await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType='MESSAGE_BULK_DELETE', targetId='channel', targetType='channel', count=3))
        self.assertEqual(report['ledger']['state'], 'partial')
        self.assertEqual(len(await ledger.entries()), 1)
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(actionType='MESSAGE_BULK_DELETE', targetId='channel', targetType='channel'))
        report = await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType='MESSAGE_BULK_DELETE', targetId='channel', targetType='channel', count=1))
        self.assertEqual(report['kind'], 'drift')
        with self.assertRaisesRegex(ValueError, 'Intent count'):
            await ledger.record(intent(correlationId='bad-count', count=0))

    async def test_exact_match_at_inclusive_tolerance_boundary(self):
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(timestamp=NOW - 120000))
        self.assertIsNone(await Reconciler(ledger, clock=lambda: NOW).reconcile(event()))
        self.assertEqual(await ledger.entries(), [])

    async def test_deterministic_partial_and_expired_near_misses(self):
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(targetId='other'))
        report = await Reconciler(ledger, clock=lambda: NOW).reconcile(event())
        self.assertEqual((report['ledger']['state'], report['confidence']), ('partial', 'medium'))
        old_ledger = Ledger(clock=lambda: NOW)
        await old_ledger.record(intent(targetId='other', expiresAt=NOW - 1))
        report = await Reconciler(old_ledger, clock=lambda: NOW).reconcile(event())
        self.assertEqual(report['ledger']['state'], 'expired')

    async def test_collapsed_bursts_match_and_under_ledgered_bursts_drift(self):
        ledger = Ledger(clock=lambda: NOW)
        for index in range(3): await ledger.record(intent(actionType='MEMBER_MOVE', targetType='member', targetId=f'member-{index}', correlationId=f'move-{index}'))
        reconciler = Reconciler(ledger, clock=lambda: NOW)
        self.assertIsNone(await reconciler.reconcile(event(actionType='MEMBER_MOVE', targetType='member', targetId='member-0', count=3)))
        self.assertEqual(await ledger.entries(), [])
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(actionType='MESSAGE_DELETE', targetType='message', targetId='x'))
        report = await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType='MESSAGE_DELETE', targetType='message', count=2))
        self.assertEqual((report['kind'], report['event']['count']), ('drift', 2))

    async def test_representative_action_coverage_reconciles_exactly(self):
        actions = ['GUILD_UPDATE','CHANNEL_DELETE','CHANNEL_OVERWRITE_UPDATE','MEMBER_KICK','MEMBER_BAN_ADD','ROLE_UPDATE','INVITE_DELETE','WEBHOOK_CREATE','EMOJI_DELETE','STICKER_UPDATE','INTEGRATION_DELETE','STAGE_INSTANCE_CREATE','GUILD_SCHEDULED_EVENT_UPDATE','THREAD_DELETE','APPLICATION_COMMAND_PERMISSION_UPDATE','AUTO_MODERATION_RULE_CREATE','AUTO_MODERATION_QUARANTINE_USER','ONBOARDING_UPDATE','VOICE_CHANNEL_STATUS_CREATE','SOUNDBOARD_SOUND_CREATE','MESSAGE_PIN']
        for action_type in actions:
            ledger = Ledger(clock=lambda: NOW)
            await ledger.record(intent(actionType=action_type, correlationId=action_type))
            self.assertIsNone(await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType=action_type)), action_type)

    async def test_mocked_gateway_detects_rogue_audit_and_self_message(self):
        reports = []
        listener = AuditListener(None, Reconciler(Ledger(clock=lambda: NOW), clock=lambda: NOW), AlertDispatcher([Collector(reports)]), lambda: 'bot')
        await listener.reconciler.ledger.record(intent())
        self.assertIsNone(await listener.handle_audit(event(actionType=10, targetType='channel')))
        await listener.handle_audit(event(actionType=10, targetId='rogue', targetType='channel', auditEntryId='audit-rogue'))
        await listener.handle_message({'id':'message-rogue','guildId':'guild','author':{'id':'bot'},'createdTimestamp':NOW})
        self.assertEqual(len(reports), 2)
        self.assertEqual(reports[0]['event']['targetId'], 'rogue')
        self.assertEqual(reports[1]['event']['actionType'], 'MESSAGE_CREATE')

    async def test_normalizes_live_discord_js_channel_audit_action_and_target_fields(self):
        listener = AuditListener(None, Reconciler(Ledger(clock=lambda: NOW), clock=lambda: NOW), AlertDispatcher(), lambda: 'bot')
        for action, expected in [(10, 'CHANNEL_CREATE'), (11, 'CHANNEL_UPDATE'), (12, 'CHANNEL_DELETE')]:
            normalized = listener.normalize_audit({'id':f'audit-{action}','action':action,'actionType':{10:'Create',11:'Update',12:'Delete'}[action],'targetId':'channel','targetType':'Channel','executorId':'bot','guildId':'guild','createdTimestamp':NOW})
            self.assertEqual((normalized['actionType'], normalized['targetType']), (expected, 'channel'))

    def test_discord_py_high_level_options_survive_conversion(self):
        action = type('Action', (), {'value': 14})()
        actor = type('User', (), {'id': 'bot'})()
        guild = type('Guild', (), {'id': 'guild'})()
        channel = type('Channel', (), {'id': 'channel'})()
        overwrite = type('Role', (), {'id': 'role', 'type': '0'})()
        entry = type('Entry', (), {'id': 'audit', 'action': action, 'target': channel, 'user': actor, 'user_id': 'bot', 'guild': guild, 'created_at': datetime.fromtimestamp(NOW / 1000, timezone.utc), 'extra': overwrite})()
        normalized = AuditListener.normalize_audit(_discord_py_entry_to_dict(entry))
        self.assertEqual((normalized['targetId'], normalized['targetType']), ('channel:role', 'overwrite'))

    async def test_500_exact_entries_leave_no_ledger_entries(self):
        ledger = Ledger(clock=lambda: NOW)
        await asyncio.gather(*(ledger.record(intent(targetId=str(i), correlationId=f'load-{i}')) for i in range(500)))
        reconciler = Reconciler(ledger, clock=lambda: NOW)
        reports = await asyncio.gather(*(reconciler.reconcile(event(targetId=str(i), auditEntryId=f'audit-{i}')) for i in range(500)))
        self.assertTrue(all(report is None for report in reports))
        self.assertEqual(await ledger.entries(), [])

    async def test_sqlite_adapter_persists_its_adapter_contract(self):
        adapter = SqliteLedgerAdapter()
        ledger = Ledger(adapter=adapter, clock=lambda: NOW)
        await ledger.record(intent())
        self.assertEqual((await ledger.entries())[0]['correlationId'], 'intent-1')
        await ledger.remove('intent-1')
        self.assertEqual(await ledger.entries(), [])
        adapter.close()

    async def test_adversarial_evasion_attempts_have_explicit_outcomes(self):
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(timestamp=NOW - 120001, expiresAt=NOW + 1))
        report = await Reconciler(ledger, clock=lambda: NOW).reconcile(event())
        self.assertEqual(report['ledger']['state'], 'partial')
        ledger = Ledger(clock=lambda: NOW)
        with self.assertRaisesRegex(ValueError, 'Unknown audit actions'): await ledger.record(intent(actionType='UNKNOWN_999'))
        report = await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType='UNKNOWN_999'))
        self.assertEqual(report['ledger']['state'], 'none')
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(targetType='role'))
        self.assertEqual((await Reconciler(ledger, clock=lambda: NOW).reconcile(event()))['kind'], 'drift')
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(expiresAt=NOW - 1))
        self.assertEqual((await Reconciler(ledger, clock=lambda: NOW).reconcile(event()))['ledger']['state'], 'expired')
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(correlationId='collision'))
        with self.assertRaisesRegex(ValueError, 'Duplicate correlationId'): await ledger.record(intent(correlationId='collision', targetId='other'))
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(targetId='poisoned'))
        self.assertIsNone(await Reconciler(ledger, clock=lambda: NOW).reconcile(event(targetId='poisoned')))

if __name__ == '__main__': unittest.main()
