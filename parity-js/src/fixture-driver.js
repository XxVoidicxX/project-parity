import { readFileSync } from 'node:fs';
import { Ledger, Reconciler } from './index.js';

const sortKeys = value => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortKeys(nested)])) : value;
const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const now = Date.parse(fixture.clock);
const ledger = new Ledger({ clock: () => now });
for (const intent of fixture.intents) await ledger.record(intent);
const reconciler = new Reconciler({ ledger, clock: () => now });
const reports = [];
for (const event of fixture.events) { const report = await reconciler.reconcile(event); if (report) reports.push(report); }
console.log(JSON.stringify(sortKeys(reports)));
