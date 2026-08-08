import asyncio, json, sys, time, tracemalloc
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'parity-py'))
from parity_py import Ledger, Reconciler

NOW = 1786104000000
SIZES = [100, 1000, 10000]
def intent(index): return {'actionType':'MESSAGE_DELETE','targetId':f'target-{index}','targetType':'message','guildId':'benchmark','correlationId':f'entry-{index}'}
def event(index, count=1): return {'actionType':'MESSAGE_DELETE','targetId':f'target-{index}','targetType':'message','guildId':'benchmark','executorId':'bot','occurredAt':'2026-08-07T12:00:00.000Z','count':count}
def percentile(values, fraction): return values[min(len(values)-1, int(-(-len(values) * fraction // 1))-1)]

async def measure(size):
    tracemalloc.start(); before = tracemalloc.get_traced_memory()[0]
    ledger = Ledger(clock=lambda: NOW)
    start = time.perf_counter()
    for index in range(size): await ledger.record(intent(index))
    record_seconds = time.perf_counter() - start
    retained = len(await ledger.entries())
    reconciler = Reconciler(ledger, clock=lambda: NOW)
    latencies = []
    for index in range(min(50, size)):
        start = time.perf_counter(); await reconciler.reconcile(event(index)); latencies.append((time.perf_counter() - start) * 1000)
    latencies.sort()
    burst_ledger = Ledger(clock=lambda: NOW)
    for index in range(size): await burst_ledger.record(intent(index))
    start = time.perf_counter(); await Reconciler(burst_ledger, clock=lambda: NOW).reconcile(event(0, size)); burst_seconds = time.perf_counter() - start
    current, _ = tracemalloc.get_traced_memory(); tracemalloc.stop()
    return {'size':size, 'recordEntriesPerSecond':size / record_seconds, 'reconcileLatencyMs':{'p50':percentile(latencies,.5),'p90':percentile(latencies,.9),'p99':percentile(latencies,.99),'samples':len(latencies)}, 'reconcileBurstEntriesPerSecond':size / burst_seconds, 'ledger':{'retainedEntries':retained,'heapGrowthBytes':current-before,'leakedEntriesAfterBurst':len(await burst_ledger.entries())}}

async def main():
    print(json.dumps({'language':'python','runtime':sys.version.split()[0],'measuredAt':time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),'sizes':[await measure(size) for size in SIZES]}))
asyncio.run(main())
