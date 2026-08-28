# Parity Local Inspection — Handoff

**Base commit:** f2edc06f922b447e1593d9ed8c4d90a32e0707e4 | **Working pack:** 1.0.2 fixes (uncommitted) | **Date inspected/tested:** 2026-08-27

## Architecture (confirmed from source)
- `parity-spec/` is the contract: strict ledger/drift schemas, reconciliation rules, 8 shared fixtures, coverage table, and canonical 69-code audit map.
- `parity-js/src/`: `attach()` + pending-operation handshake, in-memory/pluggable ledger, reconciler, discord.js listeners, alert strategies, SQLite adapter, and opt-in manager auto-wrap.
- `parity-py/parity_py/__init__.py`: equivalent core plus discord.py/py-cord event adaptation; supports both listener APIs and plain `discord.Client` method composition/restoration.
- Default storage is memory; SQLite is optional. Reconciliation consumes matching entries, so this ledger is a short-lived authorization queue, not an audit archive.
- Live tools now use only disposable `parity-test-*` resources and detach before cleanup.

## Functional flow (as implemented)
1. `attach()` creates/accepts Ledger → Reconciler → AlertDispatcher → AuditListener, registers audit + self-message gateway handlers, and returns `intent`, `track`, and `detach` (`parity-js/src/index.js:36`; `parity-py/parity_py/__init__.py:208`).
2. Target-known operation: `intent()` records canonical action/target/type/guild, UUID, timestamp, and `expiresAt`; failed `track(intent, op)` removes its orphan intent.
3. Discord-generated ID: `track(result => intent, op)` marks the operation in flight before calling Discord, records the returned ID, then releases the gateway listener. Wait is bounded to 5s (`index.js:11,49`; Python `__init__.py:272`).
4. JS `attachAutoWrap()` proxies supported guild managers. Edits/deletes are pre-recorded; creates use result-derived tracking; rejected REST calls remove intents (`auto-wrap.js:19-50`).
5. Listener filters to the bot executor, dedupes audit IDs, normalizes numeric action/target/count, waits only for active generated-ID operations, then reconciles (`audit-listener.js:3-9`; Python `AuditListener` at `__init__.py:108`).
6. Exact match consumes the oldest eligible intent. Collapsed MOVE/DISCONNECT/MESSAGE_DELETE consumes `count` intents. No full match produces schema `1.0` drift and dispatches all alert strategies.

## Answers to open questions
1. **Auto-wrap vs manual:** Not universal. JS now has an **opt-in guardrail** for channel/role/member/ban manager calls; unsupported Discord APIs and all Python outbound calls still require `intent`/`track`. It is no longer accurate to say “zero guardrail,” but forgetting an unsupported/manual intent still causes a false-positive compromise alert.
2. **Burst handling:** Yes. `MEMBER_MOVE`, `MEMBER_DISCONNECT`, and `MESSAGE_DELETE` consume up to canonical `count`; under-ledgered bursts drift. Invalid counts do not consume entries. Covered through 10,000 entries.
3. **TTL/timing:** 120s TTL + ±120s tolerance, inclusive (`ledger.js:4`, `reconciler.js:6`, rules line 5). Still no empirical justification. Live machine/Discord clocks differed ~0.5s, so snowflake delta was explicitly not treated as delivery lag.
4. **Cross-language parity:** Shared reports are byte-identical across 8 fixtures; JS/Py maps now come from the same 69-code spec and are tested against discord.js 14.27.0. End-to-end live behavior passed separately: JS 14/14; isolated discord.py 2.5.2 5/5. This is strong schema/normalization parity, not proof for every Discord action.
5. **Message-level coverage:** Guild self-authored `MESSAGE_CREATE` is covered. Result-derived tracking now solves the previously impossible pre-send message-ID problem and is live-confirmed in both languages. DMs, edits, reactions, typing, presence, voice state, and interactions remain out of v1.
6. **Storage adapter:** Pluggable `insert/all/remove` (+ optional `has`) with memory and SQLite implementations. SQLite still scans/loads all entries during reconciliation/purge and is not multi-process hardened.

## Test coverage reality check
- Default `npm test` now runs everything: root/spec/cross-language **6**, JS **21**, Python **17** = **44 automated checks**, all passing.
- Live JS: **14/14** (rogue channel create/update, manual update, auto-wrapped channel create/update, rogue + manual + wrapped role paths, webhook drift, rogue/tracked self-message, concurrency).
- Live Python in clean discord.py 2.5.2 venv: **5/5** (rogue channel create/update, manual update, rogue/tracked self-message).
- Live runs exposed and fixed: loose harness predicates, wrong action code 120, stale/missing action codes, `GuildRoleManager` vs real `RoleManager`, gateway-before-REST generated-ID races, invalid Python `guild_audit_log` intent, wrong Python event names, and plain `discord.Client` lacking `add_listener`.
- Still unverified live: collapsed Discord bursts, member moderation, reconnect/REST replay, rate limits, all 69 actions, SQLite under production concurrency, and alert retry/failure isolation.

## Gaps / risks / rough edges
1. **Coverage is partial, not transparent:** auto-wrap is opt-in and covers only selected JS managers. Unsupported calls remain omission-prone; Python has no outbound auto-wrap.
2. **Message/audit target semantics remain action-specific:** several Discord audit events do not target the object a developer intuitively acted on (notably message deletion/member actions). Those need live fixtures and explicit per-action target rules.
3. **120s is still a guess:** no measured lag distribution, per-action window, reconnect queue, or historical REST replay implementation.
4. **In-flight wait is bounded at 5s:** a generated-ID REST operation slower than that can still race and false-alert; raising it delays unrelated events that arrive while such an operation is active.
5. **Ledger is consume-on-match:** successful intent evidence disappears; production incident reconstruction needs a separate append-only sink.
6. **SQLite path is reference-grade:** synchronous calls behind async methods, full scans, no cross-process coordination/indexed expiry.

## Key code excerpts
```js
// Generated ID: register pending before operation; ledger real ID before release.
return pending.run(operation, intent, ledger);
```
```js
// Auto-wrap create; edits/deletes record before and remove on REST failure.
return parityTrack(result => ({ actionType, targetId: resolveTargetId([result]), targetType, guildId }), operation);
```
```python
# Plain discord.Client has no add_listener: compose existing handlers, restore on detach.
setattr(client, event_name, combined)
```

## Suggested next steps
1. Add canonical per-action target extraction fixtures, especially MESSAGE_DELETE, MEMBER_KICK/BAN, overwrites, bulk deletes, and options-only targets; live-test representative cases.
2. Expose/report auto-wrap coverage at runtime so unsupported calls are visible; consider Python wrappers for the same supported managers.
3. Collect real audit gateway lag/reconnect data and replace the fixed 120s/5s guesses with evidence-backed configurable policy.
4. Add a durable append-only evidence sink and SQLite concurrency/expiry indexing before production claims.
