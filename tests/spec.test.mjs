import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
