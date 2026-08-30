import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readText = path => readFileSync(join(root, path), 'utf8');
const readJson = path => JSON.parse(readText(path));
const report = () => readText('TEST_REPORT.md');

test('README links to the test report', () => assert.match(readText('README.md'), /\[Test report\]\(TEST_REPORT\.md\)/));
test('test report has a clear title', () => assert.match(report(), /^# Project Parity Test Report/m));
test('test report includes the JavaScript category', () => assert.match(report(), /JavaScript \| 40/));
test('test report includes the Python category', () => assert.match(report(), /Python \| 35/));
test('test report includes the other category', () => assert.match(report(), /Other \(contract, cross-language, release\) \| 26/));
test('test report includes a coverage map visual', () => assert.match(report(), /flowchart LR/));
test('test report includes a reconciliation flow visual', () => assert.match(report(), /flowchart TD/));
test('package versions are synchronized', () => {
  const rootVersion = readJson('package.json').version;
  assert.equal(readJson('parity-js/package.json').version, rootVersion);
  assert.equal(readJson('package-lock.json').version, rootVersion);
  assert.match(readText('parity-py/pyproject.toml'), new RegExp(`version = "${rootVersion}"`));
});
test('ledger schema remains valid JSON with a stable schema identity', () => {
  const schema = readJson('parity-spec/ledger-entry.schema.json');
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'https://project-parity.dev/schema/ledger-entry.schema.json');
});
test('drift schema remains valid JSON with a schema version', () => {
  const schema = readJson('parity-spec/drift-report.schema.json');
  assert.equal(schema.properties.schemaVersion.const, '1.0');
});
test('all shared fixtures parse as JSON', () => {
  const fixtureDirectory = join(root, 'parity-spec', 'fixtures');
  for (const name of readdirSync(fixtureDirectory).filter(name => name.endsWith('.json'))) assert.doesNotThrow(() => JSON.parse(readFileSync(join(fixtureDirectory, name), 'utf8')), name);
});
test('audit action codes are unique', () => {
  const codes = Object.keys(readJson('parity-spec/audit-action-map.json').actions);
  assert.equal(new Set(codes).size, codes.length);
});
test('audit action names are unique', () => {
  const names = Object.values(readJson('parity-spec/audit-action-map.json').actions);
  assert.equal(new Set(names).size, names.length);
});
test('agent guidance requires an onboarding doctor check', () => assert.match(readText('AGENTS.md'), /doctor/));
test('setup documentation describes automatic JavaScript tracking', () => assert.match(readText('docs/setup.md'), /autoWrap: true/));
test('the live harness exercises the one-option JavaScript setup', () => assert.match(readText('tools/live-full-test.mjs'), /attach\(client, \{ autoWrap: true/));
test('repository hygiene excludes local credentials and runtime state', () => {
  const ignore = readText('.gitignore');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.parity\/$/m);
});
