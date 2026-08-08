import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
