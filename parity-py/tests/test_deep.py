import asyncio
import random
import unittest

from parity_py import Ledger, Reconciler

NOW = 1786104000000

def intent(**overrides):
    return {'actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild','correlationId':'intent'} | overrides

def event(**overrides):
    return {'actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild','executorId':'bot','occurredAt':'2026-08-07T12:00:00.000Z','count':1} | overrides

class DeepTests(unittest.IsolatedAsyncioTestCase):
    async def test_timing_matrix_is_inclusive_and_classifies_misses(self):
        for offset, expected in [(-120000, None), (-119999, None), (119999, None), (120000, None), (-120001, 'partial'), (120001, 'partial'), (-600000, 'partial')]:
            ledger = Ledger(clock=lambda: NOW)
            await ledger.record(intent(correlationId=f'timing-{offset}', timestamp=NOW + offset, expiresAt=NOW + 999999))
            report = await Reconciler(ledger, clock=lambda: NOW).reconcile(event())
            self.assertEqual(None if report is None else report['ledger']['state'], expected, offset)
        ledger = Ledger(clock=lambda: NOW)
        await ledger.record(intent(correlationId='expired', expiresAt=NOW - 1))
        self.assertEqual((await Reconciler(ledger, clock=lambda: NOW).reconcile(event()))['ledger']['state'], 'expired')

    async def test_seeded_fuzz_preserves_invariants_and_purges(self):
        rng = random.Random(0xDECAFBAD)
        ledger = Ledger(clock=lambda: NOW, ttl_ms=1000)
        reconciler = Reconciler(ledger, clock=lambda: NOW)
        actions = ['CHANNEL_CREATE', 'ROLE_UPDATE', 'WEBHOOK_CREATE', 'THREAD_DELETE']
        exact, rogue = [], []
        for index in range(400):
            action_type, guild_id, target_id = rng.choice(actions), f"guild-{rng.randrange(4)}", f"target-{index}"
            await ledger.record(intent(actionType=action_type, guildId=guild_id, targetId=target_id, correlationId=f'fuzz-{index}', timestamp=NOW + rng.randrange(-120000, 120001), expiresAt=NOW + 500000))
            exact.append(event(actionType=action_type, guildId=guild_id, targetId=target_id))
            rogue.append(event(actionType=action_type, guildId=guild_id, targetId=f'rogue-{index}'))
        self.assertTrue(all(report is None for report in await asyncio.gather(*(reconciler.reconcile(item) for item in exact))))
        self.assertTrue(all(report and report['kind'] == 'drift' for report in await asyncio.gather(*(reconciler.reconcile(item) for item in rogue))))
        await ledger.purge(NOW + 502001, 1000)
        self.assertEqual(await ledger.entries(), [])

    async def test_10000_entry_burst_never_under_reports_and_leaks_nothing(self):
        ledger = Ledger(clock=lambda: NOW)
        for index in range(10000):
            await ledger.record(intent(actionType='MESSAGE_DELETE', targetType='message', targetId=f'message-{index}', correlationId=f'scale-{index}'))
        reconciler = Reconciler(ledger, clock=lambda: NOW)
        self.assertIsNone(await reconciler.reconcile(event(actionType='MESSAGE_DELETE', targetType='message', targetId='message-0', count=10000)))
        self.assertEqual(await ledger.entries(), [])
        await ledger.record(intent(actionType='MESSAGE_DELETE', targetType='message', correlationId='one'))
        report = await reconciler.reconcile(event(actionType='MESSAGE_DELETE', targetType='message', count=2))
        self.assertEqual(report['event']['count'], 2)
        self.assertEqual(await ledger.entries(), [])

    async def test_1000_concurrent_exact_entries_are_serialized(self):
        ledger = Ledger(clock=lambda: NOW)
        await asyncio.gather(*(ledger.record(intent(targetId=str(index), correlationId=f'concurrent-{index}')) for index in range(1000)))
        reconciler = Reconciler(ledger, clock=lambda: NOW)
        reports = await asyncio.gather(*(reconciler.reconcile(event(targetId=str(index))) for index in range(1000)))
        self.assertTrue(all(report is None for report in reports))
        self.assertEqual(await ledger.entries(), [])
