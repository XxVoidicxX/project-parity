import json
import sys

from .runtime import RuntimeStore

HELP = '''Parity CLI

Usage: parity <command> [options]

Commands:
  help                         Show this help
  init                         Create local runtime settings
  status [--json]              Show the latest attached runtime state
  check                        Validate that a live runtime state is healthy
  health [--max-age seconds]   Check runtime freshness
  logs [--limit number] [--drift] [--json]
                               Show bounded local lifecycle logs
  clear-logs                   Clear local lifecycle logs
  settings show                Show settings
  settings console <off|drift|all>
                               Toggle PM2 or terminal output
  settings log-limit <1-10000> Set retained local log count
  reset                        Remove local runtime state

Environment:
  PARITY_RUNTIME_DIR           Override the default .parity directory'''

def integer(value):
    try: return int(value)
    except (TypeError, ValueError): raise ValueError(f'Expected an integer, received {value or "nothing"}')

def render(value, as_json): return json.dumps(value, indent=2) if as_json or not isinstance(value, str) else value

def run_cli(arguments=None, store=None, out=print, error=lambda value: print(value, file=sys.stderr)):
    arguments = list(arguments or [])
    store = store or RuntimeStore()
    command, rest = (arguments[0], arguments[1:]) if arguments else ('help', [])
    as_json = '--json' in rest
    try:
        if command in {'help', '--help', '-h'}: out(HELP); return 0
        if command == 'init': out(render({'initialized': str(store.directory), 'settings': store.set_settings({})}, as_json)); return 0
        if command == 'status':
            status = store.status()
            out(render(status or {'state': 'missing', 'detail': 'No Parity runtime state exists.'}, as_json))
            return 0 if status else 1
        if command in {'check', 'health'}:
            index = rest.index('--max-age') if '--max-age' in rest else -1
            seconds = 60 if index == -1 else integer(rest[index + 1] if index + 1 < len(rest) else None)
            if seconds < 1: raise ValueError('Max age must be at least one second')
            health = store.health(seconds * 1000)
            out(render(health, as_json)); return 0 if health['ok'] else 1
        if command == 'logs':
            index = rest.index('--limit') if '--limit' in rest else -1
            limit = 50 if index == -1 else integer(rest[index + 1] if index + 1 < len(rest) else None)
            if limit < 1: raise ValueError('Log limit must be at least one')
            logs = [record for record in store.logs() if '--drift' not in rest or record.get('phase') == 'discord-drift'][-limit:]
            out(render(logs, as_json)); return 0
        if command == 'clear-logs': store.clear_logs(); out('Parity logs cleared.'); return 0
        if command == 'settings':
            setting, value = (rest[0], rest[1] if len(rest) > 1 else None) if rest else ('show', None)
            if setting == 'show': out(render(store.settings(), as_json)); return 0
            if setting == 'console': out(render(store.set_settings({'console': value}), as_json)); return 0
            if setting == 'log-limit': out(render(store.set_settings({'logLimit': integer(value)}), as_json)); return 0
            raise ValueError(f'Unknown setting: {setting}')
        if command == 'reset': store.reset(); out('Parity runtime state removed.'); return 0
        raise ValueError(f'Unknown command: {command}')
    except (IndexError, ValueError) as caught: error(f'Parity CLI: {caught}'); return 1

def main(): return run_cli(sys.argv[1:])

if __name__ == '__main__': raise SystemExit(main())
