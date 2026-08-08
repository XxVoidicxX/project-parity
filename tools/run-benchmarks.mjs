import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, args) => JSON.parse(execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
const results = { schemaVersion: '1.0', generatedAt: new Date().toISOString(), measurements: [run('node', ['benchmarks/benchmark-js.mjs']), run('python', ['benchmarks/benchmark-py.py'])] };
mkdirSync(join(root, 'benchmarks'), { recursive: true });
writeFileSync(join(root, 'benchmarks', 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log('Wrote benchmarks/results.json');
