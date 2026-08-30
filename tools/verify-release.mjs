import { readFileSync } from 'node:fs';

const tag = process.argv[2];
const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const js = JSON.parse(readFileSync(new URL('../parity-js/package.json', import.meta.url)));
const pyproject = readFileSync(new URL('../parity-py/pyproject.toml', import.meta.url), 'utf8');
const python = pyproject.match(/^version = "([^"]+)"$/m)?.[1];
const expected = `v${root.version}`;

if (!tag) throw new Error('Provide a release tag such as v1.7.1');
if (tag !== expected) throw new Error(`Tag ${tag} does not match ${expected}`);
if (js.version !== root.version || python !== root.version) throw new Error('Package versions must match before release');
