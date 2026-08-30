import shutil
import tempfile
import unittest

from parity_py import attach
from parity_py.cli import run_cli
from parity_py.runtime import RuntimeStore

class CliTests(unittest.TestCase):
    def make_store(self):
        directory = tempfile.mkdtemp(prefix='parity-cli-')
        clock = [1000]
        return directory, RuntimeStore(directory, lambda: clock[0]), clock
    def test_runtime_store_tracks_lifecycle_bounded_logs_and_health(self):
        directory, store, clock = self.make_store()
        try:
            store.set_settings({'console': 'off', 'logLimit': 2})
            store.start({'botUserId': 'bot'})
            store.record({'phase': 'code-intent-recorded', 'recordedAt': '1970-01-01T00:00:01.000Z'})
            store.record({'phase': 'discord-drift', 'recordedAt': '1970-01-01T00:00:01.000Z', 'transport': 'audit'})
            store.record({'phase': 'discord-matched', 'recordedAt': '1970-01-01T00:00:01.000Z', 'transport': 'message'})
            self.assertEqual(store.status()['events'], 3)
            self.assertEqual(store.status()['drifts'], 1)
            self.assertEqual([record['phase'] for record in store.logs()], ['discord-drift', 'discord-matched'])
            self.assertTrue(store.health()['ok'])
            clock[0] = 2000; store.heartbeat()
            self.assertEqual(store.status()['updatedAt'], '1970-01-01T00:00:02.000Z')
            clock[0] = 62001
            self.assertFalse(store.health()['ok'])
            store.stop()
            self.assertEqual(store.status()['state'], 'detached')
        finally: shutil.rmtree(directory, ignore_errors=True)
    def test_cli_settings_logs_and_check_provide_operator_output(self):
        directory, store, _ = self.make_store()
        output, errors = [], []
        try:
            self.assertEqual(run_cli(['init'], store, output.append, errors.append), 0)
            self.assertEqual(run_cli(['settings', 'console', 'drift'], store, output.append, errors.append), 0)
            self.assertEqual(run_cli(['settings', 'console', 'off'], store, output.append, errors.append), 0)
            store.start(); store.record({'phase': 'discord-drift', 'recordedAt': '1970-01-01T00:00:01.000Z', 'transport': 'audit'})
            self.assertEqual(run_cli(['logs', '--drift', '--json'], store, output.append, errors.append), 0)
            self.assertIn('discord-drift', output[-1])
            self.assertEqual(run_cli(['check', '--max-age', '60'], store, output.append, errors.append), 0)
            self.assertEqual(errors, [])
        finally: shutil.rmtree(directory, ignore_errors=True)
    def test_attach_writes_lifecycle_records_to_configured_runtime_store(self):
        directory, store, _ = self.make_store()
        class Client:
            user = type('User', (), {'id': 'bot'})()
            def add_listener(self, handler, name): pass
            def remove_listener(self, handler, name): pass
        async def run():
            parity = await attach(Client(), runtime=store, runtime_heartbeat_ms=0)
            await parity['intent']({'actionType': 'CHANNEL_UPDATE', 'targetId': 'channel', 'targetType': 'channel', 'guildId': 'guild'})
            self.assertEqual(store.status()['state'], 'attached')
            self.assertEqual(store.logs()[-1]['phase'], 'code-intent-recorded')
            await parity['detach']()
            self.assertEqual(store.status()['state'], 'detached')
        try:
            import asyncio
            asyncio.run(run())
        finally: shutil.rmtree(directory, ignore_errors=True)
