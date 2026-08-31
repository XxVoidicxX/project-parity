import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const matrixRoot = join(root, 'examples', 'bot-matrix');
const catalog = JSON.parse(readFileSync(join(matrixRoot, 'catalog.json'), 'utf8')).variants;

test('the bot matrix contains one hundred distinct copyable profiles', () => {
  assert.equal(catalog.length, 100);
  assert.equal(new Set(catalog.map(profile => profile.id)).size, 100);
  assert.equal(catalog.filter(profile => profile.language === 'javascript').length, 50);
  assert.equal(catalog.filter(profile => profile.language === 'python').length, 50);
});

test('every JavaScript bot profile works before and after Parity', async () => {
  const files = readdirSync(join(matrixRoot, 'javascript')).filter(name => name.endsWith('.mjs')).sort();
  assert.equal(files.length, 50);
  for (const file of files) {
    const example = await import(pathToFileURL(join(matrixRoot, 'javascript', file)).href);
    let calls = 0;
    const context = { guildId: 'guild', targetId: 'target', perform: async () => ({ id: `result-${file}-${++calls}`, guildId: 'guild' }), intentFor: result => ({ actionType: 'MESSAGE_CREATE', targetId: String(result.id), targetType: 'message', guildId: 'guild' }) };
    const baseline = example.createBaselineBot();
    const before = await example.runAction(context);
    assert.equal(before.guildId, 'guild', file);
    baseline.destroy();
    const enabled = example.createParityBot();
    const after = await example.runAction(context, enabled.parity);
    assert.equal(after.guildId, 'guild', file);
    if (example.profile.integration === 'track') assert.equal((await enabled.parity.ledger.entries()).length, 1, file);
    if (example.profile.integration === 'auto') assert.ok(enabled.parity.getAutoWrapCoverage().catalogue.some(entry => entry.mode === 'automatic'), file);
    enabled.parity.detach();
    enabled.client.destroy();
  }
});

test('every Python bot profile works before and after Parity', () => {
  execFileSync('python', ['tools/test-bot-matrix.py'], { cwd: root, stdio: 'inherit' });
});
