import json, sys
from pathlib import Path
from parity_py import Ledger, Reconciler, ms

fixture=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
now=ms(fixture['clock'])

async def main():
    ledger=Ledger(clock=lambda: now)
    for intent in fixture['intents']: await ledger.record(intent)
    reconciler=Reconciler(ledger,clock=lambda: now)
    reports=[]
    for event in fixture['events']:
        report=await reconciler.reconcile(event)
        if report: reports.append(report)
    print(json.dumps(reports, sort_keys=True, separators=(',', ':')))

if __name__ == '__main__':
    import asyncio
    asyncio.run(main())
