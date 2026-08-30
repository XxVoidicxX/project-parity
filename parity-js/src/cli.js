import { RuntimeStore } from './runtime-store.js';

const help = `Parity CLI\n\nUsage: parity <command> [options]\n\nCommands:\n  help                         Show this help\n  init                         Create local runtime settings\n  status [--json]              Show the latest attached runtime state\n  check                        Validate that a live runtime state is healthy\n  health [--max-age seconds]   Check runtime freshness\n  logs [--limit number] [--drift] [--json]\n                               Show bounded local lifecycle logs\n  clear-logs                   Clear local lifecycle logs\n  settings show                Show settings\n  settings console <off|drift|all>\n                               Toggle PM2 or terminal output\n  settings log-limit <1-10000> Set retained local log count\n  reset                        Remove local runtime state\n\nEnvironment:\n  PARITY_RUNTIME_DIR           Override the default .parity directory`;
const number = value => { const parsed = Number(value); if (!Number.isInteger(parsed)) throw new Error(`Expected an integer, received ${value ?? 'nothing'}`); return parsed; };
const render = (value, json) => json ? JSON.stringify(value, null, 2) : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export function runCli(argumentsList = [], { store = new RuntimeStore(), out = console.log, error = console.error } = {}) {
  const [command = 'help', ...rest] = argumentsList;
  const json = rest.includes('--json');
  try {
    if (command === 'help' || command === '--help' || command === '-h') { out(help); return 0; }
    if (command === 'init') { const settings = store.setSettings({}); out(render({ initialized: store.dir, settings }, json)); return 0; }
    if (command === 'status') { const status = store.status(); out(render(status ?? { state: 'missing', detail: 'No Parity runtime state exists.' }, json)); return status ? 0 : 1; }
    if (command === 'check' || command === 'health') {
      const index = rest.indexOf('--max-age');
      const seconds = index === -1 ? 60 : number(rest[index + 1]);
      if (seconds < 1) throw new Error('Max age must be at least one second');
      const health = store.health(seconds * 1000);
      out(render(health, json)); return health.ok ? 0 : 1;
    }
    if (command === 'logs') {
      const index = rest.indexOf('--limit');
      const limit = index === -1 ? 50 : number(rest[index + 1]);
      if (limit < 1) throw new Error('Log limit must be at least one');
      const logs = store.logs().filter(record => !rest.includes('--drift') || record.phase === 'discord-drift').slice(-limit);
      out(render(logs, json)); return 0;
    }
    if (command === 'clear-logs') { store.clearLogs(); out('Parity logs cleared.'); return 0; }
    if (command === 'settings') {
      const [setting = 'show', value] = rest;
      if (setting === 'show') { out(render(store.settings(), json)); return 0; }
      if (setting === 'console') { out(render(store.setSettings({ console: value }), json)); return 0; }
      if (setting === 'log-limit') { out(render(store.setSettings({ logLimit: number(value) }), json)); return 0; }
      throw new Error(`Unknown setting: ${setting}`);
    }
    if (command === 'reset') { store.reset(); out('Parity runtime state removed.'); return 0; }
    throw new Error(`Unknown command: ${command}`);
  } catch (caught) { error(`Parity CLI: ${caught.message}`); return 1; }
}

export { help };
