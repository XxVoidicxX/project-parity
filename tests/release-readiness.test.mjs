import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
test('test report includes the other category', () => assert.match(report(), /Other \(contract, cross-language, release\) \| 31/));
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
test('the live target harness recognizes Components V2 owner alerts', () => {
  const harness = readText('tools/live-target-test.mjs');
  assert.match(harness, /message\.components/);
  assert.match(harness, /# Parity drift detected/);
});
test('repository hygiene excludes local credentials and runtime state', () => {
  const ignore = readText('.gitignore');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.parity\/$/m);
});
test('command reference lists every command reported by both CLI implementations', () => {
  const jsHelp = execFileSync('node', ['parity-js/bin/parity.mjs', 'help'], { cwd: root, encoding: 'utf8' });
  const pythonHelp = execFileSync('python', ['-m', 'parity_py.cli', 'help'], { cwd: join(root, 'parity-py'), encoding: 'utf8' });
  assert.equal(jsHelp.replace(/\r\n/g, '\n').trim(), pythonHelp.replace(/\r\n/g, '\n').trim());
  const commands = ['help', 'init', 'status', 'check', 'health', 'logs', 'clear-logs', 'settings show', 'settings console', 'settings log-limit', 'reset'];
  const reference = readText('COMMANDS.md');
  for (const command of commands) assert.ok(reference.includes(`| \`parity ${command}\``), command);
});
test('release verification accepts only the synchronized current tag', () => {
  const version = readJson('package.json').version;
  assert.doesNotThrow(() => execFileSync('node', ['tools/verify-release.mjs', `v${version}`], { cwd: root, stdio: 'pipe' }));
  assert.throws(() => execFileSync('node', ['tools/verify-release.mjs', 'v0.0.0'], { cwd: root, stdio: 'pipe' }));
});
test('CI tests supported Node and Python versions and packages both distributions', () => {
  const workflow = readText('.github/workflows/ci.yml');
  assert.match(workflow, /node: \['22\.14\.0', '24\.x'\]/);
  assert.match(workflow, /python: \['3\.10', '3\.13'\]/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm pack --workspace=@project-parity\/js --dry-run/);
  assert.match(workflow, /python -m build parity-py/);
});
test('release workflow requires OIDC and publishes both package distributions', () => {
  const workflow = readText('.github/workflows/release.yml');
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm publish --workspace=@project-parity\/js --access public/);
  assert.match(workflow, /pypa\/gh-action-pypi-publish@release\/v1/);
  assert.match(workflow, /tools\/verify-release\.mjs/);
});
