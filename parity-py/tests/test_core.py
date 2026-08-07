import asyncio, unittest
from parity_py import Ledger,Reconciler,SqliteLedgerAdapter
NOW=1786104000000
def intent(**x): return {'actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild','correlationId':'i'} | x
def event(**x): return {'actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild','executorId':'bot','auditEntryId':'a','occurredAt':'2026-08-07T12:00:00.000Z'} | x
class Tests(unittest.IsolatedAsyncioTestCase):
 async def test_exact_and_edges(self):
  l=Ledger(clock=lambda:NOW); await l.record(intent(timestamp=NOW-120000)); self.assertIsNone(await Reconciler(l,clock=lambda:NOW).reconcile(event()))
 async def test_drift_shape_and_burst(self):
  l=Ledger(clock=lambda:NOW); await l.record(intent(targetId='wrong')); r=await Reconciler(l,clock=lambda:NOW).reconcile(event()); self.assertEqual(r['ledger']['state'],'partial'); self.assertEqual(r['schemaVersion'],'1.0')
  l=Ledger(clock=lambda:NOW); [await l.record(intent(actionType='MEMBER_MOVE',targetId=str(i),correlationId=str(i))) for i in range(3)]; self.assertIsNone(await Reconciler(l,clock=lambda:NOW).reconcile(event(actionType='MEMBER_MOVE',count=3)))
 async def test_load_and_sqlite(self):
  l=Ledger(adapter=SqliteLedgerAdapter(),clock=lambda:NOW); await asyncio.gather(*(l.record(intent(targetId=str(i),correlationId=str(i))) for i in range(500))); r=Reconciler(l,clock=lambda:NOW); rs=await asyncio.gather(*(r.reconcile(event(targetId=str(i))) for i in range(500))); self.assertTrue(all(x is None for x in rs)); self.assertEqual(len(await l.entries()),0)
if __name__=='__main__':unittest.main()

