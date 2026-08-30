# Parity Local Inspection — Handoff

**Commit:** `1.4.0` onboarding-doctor release | **Working pack:** `1.4.0` | **Date inspected/tested:** 2026-08-29

## Architecture (confirmed from source)
- `parity-spec/` is the contract: strict ledger/drift schemas, reconciliation rules, 8 report fixtures, 10 target-extraction cases, coverage table, and canonical 69-code audit map.
- `parity-js/src/` provides `attach`, an onboarding doctor, in-flight result tracking, action-specific listener normalization, serialized reconciler, a bounded operation journal, pluggable memory/SQLite ledgers, private owner-channel alerts, and opt-in manager auto-wrap.
- `parity-py/parity_py/` mirrors the core contract and ships the equivalent `parity-doctor` command; both languages accept one private Discord alert-channel option. Outbound Python actions remain manual.
- Ledger adapters are pluggable. Matching entries are consumed; the new memory-only journal preserves a bounded lifecycle trail but is not durable evidence storage. SQLite remains synchronous/reference-grade.

## Functional flow (as implemented)
1. `attach()` constructs or accepts Ledger → Reconciler → AlertDispatcher → AuditListener and registers audit plus self-message listeners.
2. `intent()` stores action, canonical target/type/guild, timestamps, UUID, optional `count`, and metadata. `track(intent, op)` removes the intent if REST fails.
3. `track(result => intent, op)` marks generated-ID work pending before REST, records the returned ID, then releases listeners; wait is bounded to 5s.
4. JS `attachAutoWrap()` proxies supported role/channel/member/ban managers. Runtime coverage lists wrapped/unsupported managers and observed known-unsupported mutations; detach restores managers/listeners.
5. `journal` records intent, success/rejection, every in-scope audit/message observation, ignored external/duplicate events, and each match/drift. `onEvent` receives the same normalized bounded record. Built-in owner alerts use result-derived tracking, so their self-message matches rather than triggering an alert loop.
6. Listener filters bot events for reconciliation, dedupes audit IDs, derives action-specific targets, waits for pending generated IDs, and reconciles. Exact/collapsed matches expose every consumed correlation ID; drift is schema `1.0` and is sent to all strategies.

## Answers to open questions
1. **Auto-wrap vs manual:** Still not universal. JS opt-in auto-wrap covers selected methods and now exposes its exact runtime coverage plus unsupported mutation calls. Standalone managers can use `parity.wrapManager`. Unsupported JS APIs and all Python outbound calls require manual `intent`/`track`; journal records only calls routed through Parity.
2. **Burst handling:** Implemented for `MEMBER_MOVE`, `MEMBER_DISCONNECT`, and `MESSAGE_DELETE`, including aggregate intent counts and invalid-count rejection. `MESSAGE_BULK_DELETE` correctly treats count as entities in one REST call, not N separate ledger rows.
3. **TTL/timing:** Default TTL and tolerance are both 120s, inclusive. The 5s pending wait and 120s policy remain guesses; the existing live runs were not valid lag-distribution measurements.
4. **Cross-language parity:** Shared drift reports remain byte-identical across 8 fixtures; 10 target cases and normalized operation-journal records are also byte-identical. Maps have 69 matching actions. This does not prove all actions live.
5. **Message-level coverage:** Self-authored guild `MESSAGE_CREATE` is live-verified. Audit message delete uses channel because Discord exposes author + channel, not deleted message ID; bulk delete adds exact count; pin/unpin uses options message ID. DMs, edits, reactions, interactions, and other non-audit actions remain out of scope.
6. **Storage adapter:** Pluggable `insert/all/remove` plus optional `has`; memory and SQLite exist. SQLite has no async I/O, indexed expiry query, transaction strategy across processes, or append-only evidence table.
7. **Owner notification:** Set `alertChannelId` / `alert_channel_id` to a private Discord channel and optionally an owner mention ID. It posts human-readable incident text; `AGENTS.md` gives AI integrations required safety steps.
8. **Onboarding validation:** `npm run doctor -- --send-test` or `parity-doctor --send-test` checks access, privacy, send permissions, owner visibility, and one tracked alert message before deployment.

## Test coverage reality check
- Current automated total: **62/62** — root/spec/cross-language **9**, JS **28**, Python **25**. New doctor tests simulate a correct private developer-bot setup, a public alert channel, a missing send permission, and tracked test-alert reconciliation in both runtimes.
- Fresh 2026-08-29 live matrices: **JS 14/14**, **Python 5/5** on py-cord 2.6.1, target/correlation **7/7**, and onboarding doctor **8/8 in JavaScript plus 8/8 in Python**. Both doctors created and removed a disposable private channel; each test message reconciled without an alert loop. Same-app webhook single-message delete remains explicitly unavailable because Discord did not audit it.
- New offline coverage: lifecycle correlation, matched correlation IDs, failure cleanup, journal retention, ignored external events, plus existing overwrite/member/message/options targets and auto-wrap coverage.
- Still not live-tested: true Discord-collapsed bursts, overwrite/pin/bulk-delete/member moderation shapes, reconnect/replay, rate limits, all 69 actions, SQLite contention, and alert retry isolation.

## Gaps / risks / rough edges
1. **No reconnect recovery:** gateway downtime can permanently miss actions; no cursor or REST audit replay exists.
2. **Timing policy is unmeasured:** fixed 120s/5s values can either mask nearby rogue actions or false-alert slow legitimate work.
3. **Journal evidence is volatile:** matches now leave bounded in-memory evidence, but restart, eviction, and attacker access to the process erase it; there is no append-only sink.
4. **Owner alerts are channel-dependent:** the doctor catches current channel/access misconfiguration, but later permission changes, notification muting, and bot send failures can still delay human response; there is no retry or out-of-band pager.
5. **Python omission risk remains:** no outbound wrappers; JavaScript coverage remains partial even though omissions are now visible.
6. **Lossy Discord targets:** single message deletes can only match at channel granularity; disconnect/prune at guild granularity. Counts limit but cannot eliminate same-window substitution risk.
7. **SQLite is reference-grade:** synchronous full scans and no cross-process coordination/indexed expiry.

## Key code excerpts
```js
if (actionType === 'MESSAGE_DELETE') return { targetId: channelId ?? 'unknown', targetType: 'channel' };
if (actionType === 'MESSAGE_BULK_DELETE') return { targetId: genericId ?? channelId ?? 'unknown', targetType: 'channel' };
```
```js
const outcome = await this.reconciler.reconcileDetailed(event);
await this.observe({ phase: outcome.status === 'matched' ? 'discord-matched' : 'discord-drift', matchedCorrelationIds: outcome.matchedCorrelationIds });
```
```js
const entry = await ledger.record(intent);
await observe({ phase: 'code-intent-recorded', source, ...projectEntry(entry) });
```

## Suggested next steps
1. Add a gateway checkpoint + bounded REST replay path with audit-ID dedupe; test disconnect/reconnect and replay ordering.
2. Add telemetry for gateway receipt time, audit snowflake time, REST duration, and pending waits; derive per-action timing policy from p50/p95/p99 data.
3. Add an append-only signed evidence sink and harden SQLite with indexed guild/action/time/expiry queries plus transaction/concurrency tests.
4. Live-test disposable overwrite, pin, bulk-delete, kick/ban, move/disconnect, and collapsed-burst cases before expanding production claims.
