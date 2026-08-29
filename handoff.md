# Parity Local Inspection — Handoff

**Base commit:** `dc1b68c5c41f6ced2317ea1b71baa10a564cface` | **Working pack:** `1.1.0` | **Date inspected/tested:** 2026-08-27

## Architecture (confirmed from source)
- `parity-spec/` is the contract: strict ledger/drift schemas, reconciliation rules, 8 report fixtures, 10 target-extraction cases, coverage table, and canonical 69-code audit map.
- `parity-js/src/` provides `attach`, in-flight result tracking, action-specific listener normalization, serialized reconciler, pluggable memory/SQLite ledgers, alert strategies, and opt-in manager auto-wrap.
- `parity-py/parity_py/__init__.py` mirrors the core contract and adapts discord.py plus py-cord high-level/raw events; outbound Python calls remain manual.
- Ledger adapters are pluggable. Matching entries are consumed, so this is an authorization queue rather than durable evidence storage; SQLite remains synchronous/reference-grade.

## Functional flow (as implemented)
1. `attach()` constructs or accepts Ledger → Reconciler → AlertDispatcher → AuditListener and registers audit plus self-message listeners.
2. `intent()` stores action, canonical target/type/guild, timestamps, UUID, optional `count`, and metadata. `track(intent, op)` removes the intent if REST fails.
3. `track(result => intent, op)` marks generated-ID work pending before REST, records the returned ID, then releases listeners; wait is bounded to 5s.
4. JS `attachAutoWrap()` proxies supported role/channel/member/ban managers. Runtime coverage lists wrapped/unsupported managers and observed known-unsupported mutations; detach restores managers/listeners.
5. Listener filters to the bot executor, dedupes audit IDs, derives action-specific targets from `target_id` plus options, waits for pending generated IDs, and reconciles.
6. Exact matches consume the oldest intent. Collapsed move/disconnect/message-delete entries consume exactly `count` units. One bulk-delete intent must match channel and count. Drift is schema `1.0` and is sent to all strategies.

## Answers to open questions
1. **Auto-wrap vs manual:** Still not universal. JS opt-in auto-wrap covers selected methods and now exposes its exact runtime coverage plus unsupported mutation calls. Standalone managers can use `parity.wrapManager`. Unsupported JS APIs and all Python outbound calls require manual `intent`/`track`.
2. **Burst handling:** Implemented for `MEMBER_MOVE`, `MEMBER_DISCONNECT`, and `MESSAGE_DELETE`, including aggregate intent counts and invalid-count rejection. `MESSAGE_BULK_DELETE` correctly treats count as entities in one REST call, not N separate ledger rows.
3. **TTL/timing:** Default TTL and tolerance are both 120s, inclusive. The 5s pending wait and 120s policy remain guesses; the existing live runs were not valid lag-distribution measurements.
4. **Cross-language parity:** Shared drift reports remain byte-identical across 8 fixtures; 10 target cases now also produce identical projections. Maps have 69 matching actions. This does not prove all actions live.
5. **Message-level coverage:** Self-authored guild `MESSAGE_CREATE` is live-verified. Audit message delete uses channel because Discord exposes author + channel, not deleted message ID; bulk delete adds exact count; pin/unpin uses options message ID. DMs, edits, reactions, interactions, and other non-audit actions remain out of scope.
6. **Storage adapter:** Pluggable `insert/all/remove` plus optional `has`; memory and SQLite exist. SQLite has no async I/O, indexed expiry query, transaction strategy across processes, or append-only evidence table.

## Test coverage reality check
- Current automated total: **48/48** — root/spec/cross-language **7**, JS **22**, Python **19**.
- Previously completed live matrices remain **JS 14/14** and isolated discord.py **5/5**. The new disposable JS target matrix passed **5/5**: bulk-delete audit count `2` matched one counted intent, cleanup verified its resources were removed, and Discord did not audit deletion of a same-app webhook message so the harness reports that coverage as unavailable.
- New offline coverage: overwrite/member/message/options targets, counted bulk-delete success/mismatch, high-level Python conversion, auto-wrap coverage reporting, unsupported mutation observation, and detach restoration.
- Still not live-tested: true Discord-collapsed bursts, overwrite/pin/bulk-delete/member moderation shapes, reconnect/replay, rate limits, all 69 actions, SQLite contention, and alert retry isolation.

## Gaps / risks / rough edges
1. **No reconnect recovery:** gateway downtime can permanently miss actions; no cursor or REST audit replay exists.
2. **Timing policy is unmeasured:** fixed 120s/5s values can either mask nearby rogue actions or false-alert slow legitimate work.
3. **Evidence disappears on match:** there is no append-only record for incident reconstruction.
4. **Python omission risk remains:** no outbound wrappers; JavaScript coverage remains partial even though omissions are now visible.
5. **Lossy Discord targets:** single message deletes can only match at channel granularity; disconnect/prune at guild granularity. Counts limit but cannot eliminate same-window substitution risk.
6. **SQLite is reference-grade:** synchronous full scans and no cross-process coordination/indexed expiry.

## Key code excerpts
```js
if (actionType === 'MESSAGE_DELETE') return { targetId: channelId ?? 'unknown', targetType: 'channel' };
if (actionType === 'MESSAGE_BULK_DELETE') return { targetId: genericId ?? channelId ?? 'unknown', targetType: 'channel' };
```
```js
const exact = eligible.filter(entry => entry.targetId === canonical.targetId && entry.count === canonical.count)[0];
```
```js
parity.getAutoWrapCoverage = () => structuredClone(state);
```

## Suggested next steps
1. Add a gateway checkpoint + bounded REST replay path with audit-ID dedupe; test disconnect/reconnect and replay ordering.
2. Add telemetry for gateway receipt time, audit snowflake time, REST duration, and pending waits; derive per-action timing policy from p50/p95/p99 data.
3. Add an append-only evidence sink and harden SQLite with indexed guild/action/time/expiry queries plus transaction/concurrency tests.
4. Live-test disposable overwrite, pin, bulk-delete, kick/ban, move/disconnect, and collapsed-burst cases before expanding production claims.
