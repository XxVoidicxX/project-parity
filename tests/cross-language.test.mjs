import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatDriftAlert, OperationJournal } from '../parity-js/src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = readdirSync(join(root, 'parity-spec', 'fixtures')).filter(name => name.endsWith('.json')).sort();
test('JavaScript and Python fixture drivers produce byte-identical canonical reports', () => {
  for (const fixture of fixtures) {
    const path = join(root, 'parity-spec', 'fixtures', fixture);
    const js = execFileSync('node', [join(root, 'parity-js', 'src', 'fixture-driver.js'), path], { encoding: 'utf8' }).trim();
    const py = execFileSync('python', ['-m', 'parity_py.fixture_driver', path], { cwd: join(root, 'parity-py'), encoding: 'utf8' }).trim();
    assert.equal(js, py, fixture);
  }
});
test('JavaScript and Python operation journals produce byte-identical lifecycle records', () => {
  const now = Date.parse('2026-08-29T12:00:00.000Z');
  const journal = new OperationJournal({ clock: () => now });
  journal.record({ phase: 'code-intent-recorded', source: 'manual', correlationId: 'corr-1', actionType: 'CHANNEL_CREATE', targetId: 'target', targetType: 'channel', guildId: 'guild' });
  journal.record({ phase: 'discord-matched', transport: 'audit', matchedCorrelationIds: ['corr-1'] });
  const js = JSON.stringify(journal.entries());
  const code = "import json; from parity_py import OperationJournal; j=OperationJournal(clock=lambda: 1788004800000); j.record({'phase':'code-intent-recorded','source':'manual','correlationId':'corr-1','actionType':'CHANNEL_CREATE','targetId':'target','targetType':'channel','guildId':'guild'}); j.record({'phase':'discord-matched','transport':'audit','matchedCorrelationIds':['corr-1']}); print(json.dumps(j.entries(),separators=(',',':')))";
  const py = execFileSync('python', ['-c', code], { cwd: join(root, 'parity-py'), encoding: 'utf8' }).trim();
  assert.equal(js, py);
});
test('JavaScript and Python format the same owner-facing drift alert', () => {
  const report = { event: { actionType: 'CHANNEL_DELETE', targetId: 'channel', guildId: 'guild', occurredAt: '2026-08-29T12:00:00.000Z' }, confidence: 'high', suggestedRemediation: ['Immediately rotate the bot token.'] };
  const js = formatDriftAlert(report, 'owner');
  const code = "import sys; from parity_py import format_drift_alert; sys.stdout.buffer.write(format_drift_alert({'event':{'actionType':'CHANNEL_DELETE','targetId':'channel','guildId':'guild','occurredAt':'2026-08-29T12:00:00.000Z'},'confidence':'high','suggestedRemediation':['Immediately rotate the bot token.']},'owner').encode())";
  const py = execFileSync('python', ['-c', code], { cwd: join(root, 'parity-py'), encoding: 'utf8' }).trim();
  assert.equal(js, py);
});
