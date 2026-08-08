import asyncio
import unittest

from parity_py import AlertDispatcher, AuditListener, Ledger, Reconciler, SqliteLedgerAdapter

NOW = 1786104000000

def intent(**overrides):
    return {'actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild','correlationId':'intent-1'} | overrides

def event(**overrides):
    return {'actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild','executorId':'bot','auditEntryId':'audit-1','occurredAt':'2026-08-07T12:00:00.000Z','count':1} | overrides

class Collector:
    def __init__(self, reports): self.reports = reports
    async def send(self, report): self.reports.append(report)

class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_ledger_writes_canonical_entry_and_purge_timing_edges(self):
        ledger = Ledger(clock=lambda: NOW)
        entry = await ledger.record(intent(correlationId='generated'))
        self.assertEqual(entry['expiresAt'], '2026-08-07T12:02:00.000Z')
        await ledger.purge(NOW + 240000)
        self.assertEqual(len(await ledger.entries()), 1)
        await ledger.purge(NOW + 240001)
        self.assertEqual(len(await ledger.entries()), 0)

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
        actions = ['GUILD_UPDATE','CHANNEL_DELETE','CHANNEL_OVERWRITE_UPDATE','MEMBER_KICK','MEMBER_BAN_ADD','ROLE_UPDATE','INVITE_DELETE','WEBHOOK_CREATE','EMOJI_DELETE','STICKER_UPDATE','INTEGRATION_DELETE','STAGE_INSTANCE_CREATE','GUILD_SCHEDULED_EVENT_UPDATE','THREAD_DELETE','APPLICATION_COMMAND_PERMISSION_UPDATE','AUTO_MODERATION_RULE_CREATE','ONBOARDING_UPDATE','VOICE_CHANNEL_STATUS_UPDATE','GUILD_SOUNDBOARD_SOUND_CREATE','GUILD_EXPRESSION_DELETE','MESSAGE_PIN']
        for action_type in actions:
            ledger = Ledger(clock=lambda: NOW)
            await ledger.record(intent(actionType=action_type, correlationId=action_type))
            self.assertIsNone(await Reconciler(ledger, clock=lambda: NOW).reconcile(event(actionType=action_type)), action_type)

    async def test_mocked_gateway_detects_rogue_audit_and_self_message(self):
        reports = []
        listener = AuditListener(None, Reconciler(Ledger(clock=lambda: NOW), clock=lambda: NOW), AlertDispatcher([Collector(reports)]), lambda: 'bot')
        await listener.reconciler.ledger.record(intent())
        self.assertIsNone(await listener.handle_audit(event(actionType=10, targetType='channel')))
        await listener.handle_audit(event(actionType=10, targetId='rogue', targetType='channel'))
        await listener.handle_message({'id':'message-rogue','guildId':'guild','author':{'id':'bot'},'createdTimestamp':NOW})
        self.assertEqual(len(reports), 2)
        self.assertEqual(reports[0]['event']['targetId'], 'rogue')
        self.assertEqual(reports[1]['event']['actionType'], 'MESSAGE_CREATE')

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
