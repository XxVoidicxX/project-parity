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
  assert.deepEqual(schema.properties.count, { type: 'integer', minimum: 1, maximum: 10000 });
});

test('canonical target extraction fixtures match in JavaScript and Python', async () => {
  const { AuditListener } = await import('../parity-js/src/index.js');
  const cases = read('target-extraction-fixtures.json').cases;
  const project = event => Object.fromEntries(['actionType', 'targetId', 'targetType', 'count'].map(key => [key, event[key]]));
  const listener = new AuditListener();
  const js = cases.map(({ raw }) => project(listener.normalizeAudit(raw, { id: raw.guildId })));
  const python = JSON.parse(execFileSync('python', ['-c', [
    'import json,sys',
    'sys.path.insert(0,"parity-py")',
    'from parity_py import AuditListener',
    'cases=json.load(sys.stdin)["cases"]',
    'keys=("actionType","targetId","targetType","count")',
    'print(json.dumps([{k:v for k,v in AuditListener.normalize_audit(case["raw"]).items() if k in keys} for case in cases]))',
  ].join(';')], { cwd: root, input: JSON.stringify({ cases }), encoding: 'utf8' }));
  assert.deepEqual(js, cases.map(({ expected }) => expected));
  assert.deepEqual(python, js);
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

test('canonical action map matches the installed discord.js audit event enum', async () => {
  const specMap = read('audit-action-map.json').actions;
  const { AuditLogEvent } = await import('discord.js');
  const canonical = value => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  const runtimeMap = Object.fromEntries(Object.entries(AuditLogEvent)
    .filter(([, code]) => Number.isInteger(code))
    .map(([name, code]) => [String(code), canonical(name)]));
  assert.deepEqual(specMap, runtimeMap);
});

