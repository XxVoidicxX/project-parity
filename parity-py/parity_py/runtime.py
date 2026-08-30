import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_SETTINGS = {'console': 'off', 'logLimit': 500}

def iso(value): return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

class RuntimeStore:
    def __init__(self, directory=None, clock=lambda: int(datetime.now().timestamp() * 1000)):
        self.directory = Path(directory or os.getenv('PARITY_RUNTIME_DIR') or Path.cwd() / '.parity').resolve()
        self.clock = clock
        self.paths = {name: self.directory / f'{name}.json' for name in ('settings', 'status', 'logs')}
    def ensure(self): self.directory.mkdir(parents=True, exist_ok=True)
    def _read(self, name, fallback):
        path = self.paths[name]
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else fallback
    def _write(self, name, value):
        self.ensure()
        temporary = self.paths[name].with_name(f'{self.paths[name].name}.{os.getpid()}.{uuid.uuid4().hex}.tmp')
        temporary.write_text(json.dumps(value, indent=2), encoding='utf-8')
        temporary.replace(self.paths[name])
    def settings(self): return {**DEFAULT_SETTINGS, **self._read('settings', {})}
    def set_settings(self, updates):
        next_settings = {**self.settings(), **updates}
        if next_settings['console'] not in {'off', 'drift', 'all'}: raise ValueError('Console mode must be off, drift, or all')
        if isinstance(next_settings['logLimit'], bool) or not isinstance(next_settings['logLimit'], int) or not 1 <= next_settings['logLimit'] <= 10000: raise ValueError('Log limit must be an integer from 1 through 10000')
        self._write('settings', next_settings)
        return next_settings
    def status(self): return self._read('status', None)
    def logs(self): return self._read('logs', [])
    def start(self, details=None):
        previous = self.status()
        now = iso(self.clock())
        status = {'schemaVersion': '1.0', 'state': 'attached', 'startedAt': previous['startedAt'] if previous and previous.get('state') == 'attached' else now, 'updatedAt': now, 'events': previous.get('events', 0) if previous else 0, 'drifts': previous.get('drifts', 0) if previous else 0, **(details or {})}
        self._write('status', status)
        return status
    def record(self, record):
        settings = self.settings()
        self._write('logs', [*self.logs(), record][-settings['logLimit']:])
        previous = self.status() or self.start()
        status = {**previous, 'state': 'attached', 'updatedAt': iso(self.clock()), 'events': previous.get('events', 0) + 1, 'drifts': previous.get('drifts', 0) + (1 if record.get('phase') == 'discord-drift' else 0), 'lastEvent': {'phase': record.get('phase'), 'recordedAt': record.get('recordedAt'), 'transport': record.get('transport')}}
        self._write('status', status)
        transport = f" {record.get('transport')}" if record.get('transport') else ''
        if settings['console'] == 'all' or settings['console'] == 'drift' and record.get('phase') == 'discord-drift': print(f"[parity] {record.get('phase')}{transport}")
        return record
    def heartbeat(self):
        previous = self.status()
        if previous is None or previous.get('state') != 'attached': return previous
        status = {**previous, 'updatedAt': iso(self.clock())}
        self._write('status', status)
        return status
    def stop(self):
        previous = self.status() or self.start()
        status = {**previous, 'state': 'detached', 'stoppedAt': iso(self.clock()), 'updatedAt': iso(self.clock())}
        self._write('status', status)
        return status
    def clear_logs(self): self._write('logs', [])
    def reset(self):
        if self.directory.exists(): shutil.rmtree(self.directory)
    def health(self, max_age_ms=60000):
        status = self.status()
        if status is None: return {'ok': False, 'detail': 'No Parity runtime state exists. Start the bot once first.'}
        if status.get('state') != 'attached': return {'ok': False, 'detail': f"Parity is {status.get('state')}."}
        try: age = self.clock() - int(datetime.fromisoformat(status['updatedAt'].replace('Z', '+00:00')).timestamp() * 1000)
        except (KeyError, ValueError): return {'ok': False, 'detail': 'Parity status timestamp is invalid.'}
        if age > max_age_ms: return {'ok': False, 'detail': f'Parity status is stale by {age // 1000} seconds.'}
        return {'ok': True, 'detail': f'Attached and updated {age // 1000} seconds ago.'}
