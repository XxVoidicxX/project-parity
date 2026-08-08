import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = name => JSON.parse(readFileSync(new URL(`../parity-spec/${name}`, import.meta.url)));

test('ledger contract has required interoperable fields', () => {
  const schema = read('ledger-entry.schema.json');
  assert.deepEqual(schema.required, ['actionType', 'targetId', 'targetType', 'guildId', 'timestamp', 'correlationId', 'expiresAt']);
  assert.equal(schema.additionalProperties, false);
});

test('drift contract has stable report envelope', () => {
  const schema = read('drift-report.schema.json');
  assert.equal(schema.properties.schemaVersion.const, '1.0');
  assert.deepEqual(schema.properties.ledger.properties.state.enum, ['none', 'partial', 'expired']);
  assert.equal(schema.properties.event.properties.count.minimum, 1);
});

test('rules cover collapse and self-message gaps', () => {
  const rules = readFileSync(new URL('../parity-spec/reconciliation-rules.md', import.meta.url), 'utf8');
  assert.match(rules, /MEMBER_MOVE/);
  assert.match(rules, /MESSAGE_CREATE/);
  assert.match(rules, /120 seconds/);
});

test('JS and Python action maps match parity-spec/audit-action-map.json', async () => {
  const specMap = read('audit-action-map.json');
  const specEntries = new Map(Object.entries(specMap.actions).map(([k, v]) => [Number(k), v]));
  const { auditActionNames } = await import('../parity-js/src/contract.js');
  for (const [code, name] of specEntries) assert.equal(auditActionNames.get(code), name, `JS: code ${code}`);
  assert.equal(auditActionNames.size, specEntries.size, 'JS map has extra entries');
  const pyOut = execFileSync('python', ['-c', 'import sys; sys.path.insert(0,"parity-py"); from parity_py import ACTIONS; import json; print(json.dumps({str(k):v for k,v in ACTIONS.items()}))'], { cwd: root, encoding: 'utf8' }).trim();
  const pyMap = new Map(Object.entries(JSON.parse(pyOut)).map(([k, v]) => [Number(k), v]));
  for (const [code, name] of specEntries) assert.equal(pyMap.get(code), name, `Python: code ${code}`);
  assert.equal(pyMap.size, specEntries.size, 'Python map has extra entries');
});

