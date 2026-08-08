# Project Parity test report

**Version reported: 1.0.0**

This release pass exercised both implementations beyond their basic contract cases. The focus was matching at timing boundaries, malformed or unmatched self-actions, collapsed audit bursts, retention behavior, and serialized reconciliation under concurrent calls. The random scenarios use fixed seeds and injected clocks, so a failure should be reproducible rather than dependent on wall-clock timing.

## Suite results

| Suite | Scope | Count | Result |
| --- | --- | ---: | --- |
| Root specification tests | JSON schemas and documented rules | 3 | Pass |
| Cross-language driver | 7 shared fixtures with byte-identical reports | 1 | Pass |
| JavaScript unit and stress tests | Core behavior, seeded fuzzing, 10,000-entry burst, 1,000 concurrent reconciliations | 15 | Pass |
| Python unit and stress tests | Matching parity, seeded fuzzing, 10,000-entry burst, 1,000 concurrent reconciliations | 13 | Pass |
| Live harness without token | Safe skip behavior | 1 manual command | Pass |

The JavaScript root run completed with 19 passing test cases across the specification, cross-language, and package suites. The Python run completed with 13 passing test cases.

## Benchmark method

Benchmarks were run on this Windows machine on 2026-08-08 using Node v22.14.0 and Python 3.13.14. Each size records 100, 1,000, or 10,000 in-memory `MESSAGE_DELETE` intents. Reconcile latency is measured across up to 50 exact events after the ledger is populated. Burst throughput measures one collapsed event that consumes the populated ledger. Heap growth is process-local instrumentation and includes runtime allocation effects, so it is useful for comparison within a run but is not a portable memory limit.

### JavaScript measurements

| Entries | Record entries/sec | Reconcile p50 ms | p90 ms | p99 ms | Burst entries/sec | Heap growth bytes | Leaked after burst |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 62,826 | 0.31 | 0.58 | 0.71 | 10,710 | 595,112 | 0 |
| 1,000 | 177,538 | 3.02 | 3.32 | 4.08 | 191,957 | 2,295,768 | 0 |
| 10,000 | 192,368 | 31.21 | 34.69 | 36.21 | 177,155 | 14,071,640 | 0 |

### Python measurements

| Entries | Record entries/sec | Reconcile p50 ms | p90 ms | p99 ms | Burst entries/sec | Heap growth bytes | Leaked after burst |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 25,239 | 1.43 | 1.92 | 2.62 | 37,549 | 62,594 | 0 |
| 1,000 | 31,895 | 18.89 | 20.50 | 23.97 | 37,771 | 608,598 | 0 |
| 10,000 | 29,809 | 184.59 | 198.07 | 235.02 | 36,179 | 5,584,598 | 0 |

The raw, machine-readable measurements are retained in [`benchmarks/results.json`](../benchmarks/results.json). Values will change on another machine or after a runtime upgrade.

## Charts

![Reconcile latency percentiles](../benchmarks/charts/latency-percentiles.svg)

![Record and burst throughput](../benchmarks/charts/throughput-by-size.svg)

![Ledger heap growth](../benchmarks/charts/ledger-memory.svg)

## What we could not test

No real Discord tenant or token was used during this pass. We could not measure real audit-log gateway delivery latency, permission failures, Discord-side event collapse frequency, reconnect behavior, or rate-limit behavior. The live harness is intentionally operator-driven and needs a dedicated guild and disposable channel to validate that path.

The stress tests use the in-memory ledger. They verify entry cleanup and reconciliation correctness, but they do not establish SQLite throughput, process memory ceilings, multi-process writer behavior, or a production retention policy. The benchmark memory figures are not a substitute for heap profiling under a deployed bot workload.

## How to reproduce

From the repository root in PowerShell:

```powershell
npm test
Set-Location parity-py
python -m unittest discover -s tests
Set-Location ..
npm run benchmark
node tools/live-parity-check
```

The last command skips successfully when `DISCORD_BOT_TOKEN` is absent. For an operator-run tenant check, follow [setup instructions](setup.md#live-discord-check), rotate the token first, set it only in the environment or ignored `.env`, and provide the required guild and test-channel identifiers.
