import asyncio
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / 'examples' / 'bot-matrix'

class Result:
    def __init__(self, identifier):
        self.id = identifier

def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

async def main():
    catalog = json.loads((MATRIX / 'catalog.json').read_text(encoding='utf-8'))['variants']
    assert len(catalog) == 100
    files = sorted((MATRIX / 'python').glob('*.py'))
    assert len(files) == 50
    for path in files:
        module = load(path)
        calls = 0
        async def perform():
            nonlocal calls
            calls += 1
            return Result(f'result-{path.stem}-{calls}')
        def intent_for(result):
            return {'actionType': 'MESSAGE_CREATE', 'targetId': str(result.id), 'targetType': 'message', 'guildId': 'guild'}
        context = {'guildId': 'guild', 'targetId': 'target', 'perform': perform, 'intent_for': intent_for}
        baseline = module.create_baseline_bot()
        before = await module.run_action(context)
        assert before.id.startswith('result-')
        await baseline.close()
        enabled = await module.create_parity_bot()
        after = await module.run_action(context, enabled['parity'])
        assert after.id.startswith('result-')
        assert len(await enabled['parity']['ledger'].entries()) == 1
        await enabled['parity']['detach']()
        await enabled['client'].close()
    print('50 Python bot profiles passed before and after Parity.')

asyncio.run(main())
