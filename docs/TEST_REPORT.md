# Project Parity test report

**Version reported: 1.3.0**

This release pass exercised both implementations beyond their basic contract cases. The focus was matching at timing boundaries, malformed or unmatched self-actions, collapsed audit bursts, retention behavior, and serialized reconciliation under concurrent calls. The random scenarios use fixed seeds and injected clocks, so a failure should be reproducible rather than dependent on wall-clock timing.

## Suite results

| Suite | Scope | Count | Result |
| --- | --- | ---: | --- |
| Root specification and cross-language tests | Schemas, rules, 8 byte-identical report fixtures, target extraction fixtures, generated maps, discord.js enum, byte-identical journal and owner-alert records | 9 | Pass |
| JavaScript unit and stress tests | Core behavior, attach/track/auto-wrap coverage, lifecycle journal, private owner alerts, counted bulk deletes, seeded fuzzing, 10,000-entry burst, 1,000 concurrent reconciliations | 25 | Pass |
| Python unit and stress tests | Core behavior, both registration paths, lifecycle journal, private owner alerts, target extraction, counted bulk deletes, generated-ID race, fuzzing and stress | 22 | Pass |
| JavaScript live matrix | Disposable channels, roles, webhook, self-messages, manual and wrapped reconciliation | 14 | Pass |
| Python live matrix | py-cord 2.6.1, disposable channel and self-messages | 5 | Pass |
| JavaScript live target matrix | Disposable owner alert, webhook messages, audit target inspection, exact bulk-delete count, lifecycle correlation, cleanup verification | 7 | Pass |

The root `npm test` command runs all **56** checks: 9 specification/cross-language, 25 JavaScript, and 22 Python.

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

The 2026-08-27 pass used a real Discord tenant and disposable resources. It verified live gateway delivery, permission checks, channel/role/webhook normalization, manual intents, auto-wrap, and generated message IDs. It did not force Discord-side collapsed bursts, reconnect/outage recovery, rate limits, member moderation, or every mapped action type. Local time differed from Discord snowflake timestamps by roughly half a second during the JS run, so those deltas are not treated as delivery-latency measurements.

The stress tests use the in-memory ledger. They verify entry cleanup and reconciliation correctness, but they do not establish SQLite throughput, process memory ceilings, multi-process writer behavior, or a production retention policy. The benchmark memory figures are not a substitute for heap profiling under a deployed bot workload.

## How to reproduce

From the repository root in PowerShell:

```powershell
npm test
npm run benchmark
npm run live-test
npm run live-test:py
npm run live-test:targets
```

The live commands skip successfully when credentials are absent. For an operator-run tenant check, use an isolated Python environment containing only `discord.py` (not py-cord in the same environment), follow [setup instructions](setup.md#live-discord-check), set the token only in the environment or ignored `.env`, and provide `PARITY_GUILD_ID`.

---

## Version 1.3.0 owner alerts

JavaScript `attach()` accepts `alertChannelId` and `alertUserId`; Python accepts `alert_channel_id` and `alert_user_id`. When configured, Parity posts a short incident message to that private Discord channel and optionally mentions its owner. The message is intentionally non-technical: it says that the process did not plan the action, identifies the action/target/guild/time/confidence, and gives the immediate containment step. Tests exercise the real `attach()` path in both languages and assert identical message bytes across runtimes. The 2026-08-29 disposable target run passed **7/7**, including real owner-alert delivery and verification that the alert message reconciled once without looping.

---

## Version 1.2.0 lifecycle correlation and live validation

`attach()` now exposes a bounded in-memory `journal`, with an optional `onEvent` delivery hook. It records code-side intent, REST success or rejection, audit/message observation, ignored non-bot or duplicate events, and the final matched or drift outcome. A match includes every consumed `correlationId`, including collapsed-burst matches. The existing drift report format and `reconcile()` return value remain unchanged.

The full JavaScript live matrix passed **14/14** on 2026-08-29 and removed every disposable resource. The target matrix passed **6/6**, including a real `MESSAGE_BULK_DELETE` audit with `count=2` mapped to the exact intent correlation ID. The Python matrix passed **5/5** on py-cord 2.6.1 after the harness was corrected to attach from both discord.py's `setup_hook` and py-cord's ready lifecycle. Same-app webhook single-message deletes remained unaudited, which the target harness treats as explicitly unavailable rather than a passing match.

---

## Version 1.1.0 target contract and coverage visibility

The action-specific target pass was derived from Discord's current Audit Log Entry and Optional Audit Entry Info tables, then checked against discord.js 14.27.0 and isolated discord.py 2.5.2 object models. Ten shared cases assert identical JavaScript/Python projections for overwrites, kicks, message delete/bulk/pin, move/disconnect, invites, voice status, and AutoMod.

This pass also found a cardinality bug: `MESSAGE_BULK_DELETE` reports the number of deleted messages, while the prior generic reconciler interpreted that number as requiring the same number of separate ledger entries. The ledger now accepts a validated optional `count`; one bulk intent must match both channel and count. Mismatches drift without consuming the intent.

Auto-wrap coverage is inspectable at runtime. Tests verify wrapped and unsupported manager reporting, known-unsupported mutation observations, cleanup of rejected operations, `guildCreate` listener removal, and original-manager restoration on detach. The disposable target harness passed 5/5 on 2026-08-29: Discord delivered `MESSAGE_BULK_DELETE` with `count=2`, the counted channel intent reconciled, and cleanup verified that its webhook and channel were removed. Discord did not audit deletion of a same-app webhook message, so single-message delete remains explicitly unavailable without a second identity or a human-authored fixture. Member moderation, real collapsed bursts, overwrites, and pins still need live fixtures.

---

## Version 1.0.2 live verification and race fixes

The original comprehensive harness reported 7/9, but two assertions were invalid: one searched for mixed-case `Update` inside canonical `CHANNEL_UPDATE`, and another accepted `ROLE_CREATE` as proof of a role-update drift. After exact action/target/start-index isolation, the first corrected run exposed real generated-ID races and a wrong `GuildRoleManager` class-name assumption. The in-flight operation handshake and `RoleManager` correction were then implemented and tested.

- JavaScript live matrix: **14/14 pass** on discord.js 14.27.0.
- Python live matrix: **5/5 pass** in an isolated discord.py 2.5.2 environment.
- Live-confirmed drift: unrecorded channel create/update, role update, webhook create, and guild self-message.
- Live-confirmed clean reconciliation: manual channel/role updates, auto-wrapped channel/role creates and updates, and result-derived tracked messages.
- Cleanup: all temporary `parity-test-*` and `parity-py-test-*` channels, roles, and webhooks were deleted.
- Environment finding: the host's global Python environment contained both discord.py and py-cord in the same `discord` namespace; it was rejected as an integration-test environment rather than used as evidence.

The canonical action map was also corrected against Discord's audit-log table and discord.js 14.27.0. Version 1.1.0 later aligned code 192 to `VOICE_CHANNEL_STATUS_CREATE`, which now matches both the current table and discord.js; Discord's April 2026 changelog still describes the same code as “update.”

---

## Version 1.0.1 live test results and hardening findings

### Live test run against VSH Codebase - 2026-08-08

The bot (Project Parity#0765, id 1535653385846394942) was connected to the "VSH Codebase" guild. All temporary test channels were created by the bot and deleted before the harness exited. No existing channels were touched.

#### Live test results

| Check | Result | Notes |
| --- | --- | --- |
| Required permissions present (ViewAuditLog, ManageChannels, SendMessages) | Pass | |
| Unrecorded channel create flagged as drift | Pass | actionType=Create, targetType=Channel (pre-fix shapes) |
| Unrecorded channel update flagged as drift | Pass | actionType=Update, targetType=Channel |
| Recorded legit update (learned normalized shape) produces no drift | Pass | Reconciled cleanly |
| Naive-shape intent (CHANNEL_UPDATE / channel) reconciles | Fail | FALSE POSITIVE confirmed |
| Unrecorded self-message flagged as drift | Pass | |
| **Total** | **5/6** | The fail directly caused the 1.0.1 normalization fix |

The failing check was the most valuable result of the run. It proved that a developer using the intuitive actionType string would get false-positive drift alerts on legitimate channel updates.

#### Confirmed normalization bug and fix

discord.js delivers the audit-log entry with `entry.action` as a numeric code (10, 11, 12) and `entry.actionType` as a generic category string ("Create", "Update", "Delete"). The previous `normalizeAudit()` preferred `entry.actionType` because it was non-null. Since `actionName()` passes strings through unchanged, the stored action was "Update" rather than "CHANNEL_UPDATE".

The fix: prefer `entry.action` (numeric) over `entry.actionType` (category string). The existing action-name map already contained all the correct canonical names. Also: `targetType` from discord.js arrives capitalized ("Channel"). The normalizer now lowercases it unconditionally.

After the fix, a developer recording `{ actionType: 'CHANNEL_UPDATE', targetType: 'channel' }` before a channel edit will get a clean reconciliation with no drift.

#### Observed audit-log delivery latency

The channel create at 2026-08-08T15:48:10 produced a drift event with `occurredAt: 2026-08-08T15:48:10.068Z`. This is a single data point with near-zero observed delivery lag. It cannot be generalized without a larger sample across varied conditions, but it suggests that the 120-second tolerance window is conservatively large for simple channel operations.

#### Attack surfaces investigated (1.0.1 hardening)

| Attack | Outcome |
| --- | --- |
| discord.js action/targetType normalization mismatch | Fixed; regression test added |
| MEMBER_MOVE/DISCONNECT target extraction from entry.extra | Fixed; targetId now reads extra.channel.id first for those actions |
| count=0, count=-1, count=999999 in burst event | Fixed; invalid counts clamp and report drift; no ledger entries consumed |
| 50,000-entry purge performance | Holds; purge completes under 5 seconds |
| Clock-skew expiry boundary | Holds; expiry is relative to event.occurredAt, not reconciler clock |
| Dedup replay documentation | Documented in threat-model.md; correct by design |
| Ledger poisoning orphan lifecycle | Holds; orphan consumed by first matching event, purged on schedule |
| Concurrent record() race on duplicate check | Fixed; record() now serialized with a write queue |
| Guild ID type coercion (integer vs string) | Holds; stringId() handles numeric guild IDs |
| Prototype pollution via JSON.parse | Fixed; recordLocked() uses hasOwnProperty extraction |
| DM from bot produces no drift | Holds; handleMessage() skips when guildId is absent |

#### Updated suite counts after 1.0.1

| Suite | Count | Result |
| --- | --- | --- |
| Root spec + cross-language | 4 | Pass |
| JavaScript unit, hardening, stress | 18 | Pass |
| Python unit, hardening, stress | 14 | Pass |
