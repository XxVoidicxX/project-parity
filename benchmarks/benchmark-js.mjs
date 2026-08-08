import { performance } from 'node:perf_hooks';
import { Ledger, Reconciler } from '../parity-js/src/index.js';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const sizes = [100, 1000, 10000];
const clock = () => NOW;
const intent = index => ({ actionType: 'MESSAGE_DELETE', targetId: `target-${index}`, targetType: 'message', guildId: 'benchmark', correlationId: `entry-${index}` });
const event = (index, count = 1) => ({ actionType: 'MESSAGE_DELETE', targetId: `target-${index}`, targetType: 'message', guildId: 'benchmark', executorId: 'bot', occurredAt: new Date(NOW).toISOString(), count });
const percentile = (values, fraction) => values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];

async function measure(size) {
  const before = process.memoryUsage().heapUsed;
  const ledger = new Ledger({ clock });
  const recordStart = performance.now();
  for (let index = 0; index < size; index++) await ledger.record(intent(index));
  const recordSeconds = (performance.now() - recordStart) / 1000;
  const retainedEntries = (await ledger.entries()).length;
  const latencies = [];
  const reconciler = new Reconciler({ ledger, clock });
  const samples = Math.min(50, size);
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    await reconciler.reconcile(event(index));
    latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  const burstLedger = new Ledger({ clock });
  for (let index = 0; index < size; index++) await burstLedger.record(intent(index));
  const burstStart = performance.now();
  await new Reconciler({ ledger: burstLedger, clock }).reconcile(event(0, size));
  const burstSeconds = (performance.now() - burstStart) / 1000;
  return { size, recordEntriesPerSecond: size / recordSeconds, reconcileLatencyMs: { p50: percentile(latencies, .5), p90: percentile(latencies, .9), p99: percentile(latencies, .99), samples }, reconcileBurstEntriesPerSecond: size / burstSeconds, ledger: { retainedEntries, heapGrowthBytes: process.memoryUsage().heapUsed - before, leakedEntriesAfterBurst: (await burstLedger.entries()).length } };
}

const measurements = [];
for (const size of sizes) measurements.push(await measure(size));
console.log(JSON.stringify({ language: 'javascript', runtime: process.version, measuredAt: new Date().toISOString(), sizes: measurements }));
