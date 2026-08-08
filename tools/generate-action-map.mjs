/**
 * Reads parity-spec/audit-action-map.json and regenerates the action-map
 * constants in parity-js/src/contract.js and parity-py/parity_py/__init__.py.
 *
 * Run: node tools/generate-action-map.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const spec = JSON.parse(readFileSync(join(root, 'parity-spec', 'audit-action-map.json'), 'utf8'));

const entries = Object.entries(spec.actions).map(([code, name]) => [Number(code), name]);
entries.sort((a, b) => a[0] - b[0]);

// ---- JS ----
const jsMapEntries = entries.map(([code, name]) => `[${code}, '${name}']`).join(', ');
const contractPath = join(root, 'parity-js', 'src', 'contract.js');
let contract = readFileSync(contractPath, 'utf8');
contract = contract.replace(
  /export const auditActionNames = new Map\(\[.*?\]\);/s,
  `export const auditActionNames = new Map([${jsMapEntries}]);`
);
writeFileSync(contractPath, contract, 'utf8');
console.log('Updated parity-js/src/contract.js');

// ---- Python ----
const pyEntries = entries.map(([code, name]) => `${code}:'${name}'`).join(',');
const initPath = join(root, 'parity-py', 'parity_py', '__init__.py');
let init = readFileSync(initPath, 'utf8');
init = init.replace(
  /ACTIONS = \{[^}]+\}/s,
  `ACTIONS = {${pyEntries}}`
);
writeFileSync(initPath, init, 'utf8');
console.log('Updated parity-py/parity_py/__init__.py');

console.log(`Synced ${entries.length} action codes.`);
