# Parity Local Inspection — Handoff

**Commit:** 4aa40b85e671f48ae3581cd79aad76dc20a63ba2 (HEAD, clean tree) | **Date inspected:** 2026-08-08

Read from source, not README. Repo = a spec + two reference libs (JS/Py) that detect Discord bot **token compromise**: if the bot's identity performs an audit-logged action the host app never "intended," a drift report fires.

## Architecture (confirmed from source)
- **`parity-spec/`** — the contract. Two JSON Schemas (`ledger-entry`, `drift-report`, both `additionalProperties:false`, drift `schemaVersion` const `"1.0"`), `reconciliation-rules.md`, `action-type-coverage.md`, and 8 pre-normalized `fixtures/*.json` used for cross-language byte-equality.
- **`parity-js/src/`** — real modules: `index.js` (`attach`), `ledger.js` (`Ledger` + `MemoryLedgerAdapter`), `reconciler.js`, `audit-listener.js`, `alerts.js`, `contract.js` (normalization helpers + numeric→name action map, ~60 entries), `sqlite-ledger-adapter.js` (uses `node:sqlite`), `fixture-driver.js`.
- **`parity-py/parity_py/__init__.py`** — the *entire* Python lib in one file: same class names (Ledger, Reconciler, AuditListener, AlertDispatcher, adapters, `attach`). Separate `fixture_driver.py`.
- **Storage** = in-memory `Map`/`dict` by default; SQLite adapter is optional and pluggable (see Q6). Not persistent unless you opt into SQLite.
- **Ledger is a consume-on-match queue**, not a log: an exact match *removes* the entry (`ledger.remove`). It's a reconciliation buffer with TTL, not an audit trail.

## Functional flow (as implemented)
1. Host app calls `parity.intent({actionType, targetId, targetType, guildId})` **before** it calls Discord. `Ledger.record` canonicalizes fields, assigns `correlationId` (UUID) + `timestamp` (injected clock) + `expiresAt = timestamp + ttlMs`, rejects `UNKNOWN_*` and duplicate IDs, and inserts. Writes are serialized (JS: promise write-queue; Py: `asyncio.Lock`).
2. Discord later emits the audit-log gateway event. **JS**: `attach()` calls `listener.start()`, which registers `client.on('guildAuditLogEntryCreate')` and `client.on('messageCreate')`. **Py**: `attach()` builds an `AuditListener` but does **not** register anything — the host must call `handle_audit`/`handle_message` itself (see Q1/Q4).
3. Listener `normalizeAudit` maps numeric action → canonical name, extracts target (voice-channel id from `extra.channel.id` for MEMBER_MOVE/DISCONNECT), lowercases targetType, pulls `count` from `extra.count`. It **filters to events where `executorId == botUserId`** and dedupes by `auditEntryId` (JS only; 10-min TTL map).
4. `Reconciler.reconcile` canonicalizes/clamps `count`, finds eligible ledger entries (same guild+action+targetType, unexpired at event time, within ±120s tolerance). Burst path for collapsed actions consumes up to `count`; otherwise exact path consumes the single oldest matching `targetId`.
5. Match → entry removed, returns `null`, no alert. No match → `report()` builds a drift report with nearest-entry projection, `state` ∈ none/partial/expired, confidence high/medium, fixed remediation array → `dispatcher.dispatch` fans out to alert strategies (webhook / DM / custom).

## Answers to open questions
1. **Auto-wrap vs manual: MANUAL — this is the core false-positive risk.** The developer must call `parity.intent(...)` before *every* privileged call. There is **no guard rail** — nothing wraps or proxies the Discord client. `attach` returns `intent` and a `track(intent, operation)` convenience (JS `index.js:9`) but nothing forces their use. The example bots demonstrate this: each of `kickMember`/`banMember`/`setChannelTopic` hand-writes an `intent()` before the API call (`examples/discord-bot-js/bot.js:57,69,84`). Forget one legitimate action → the bot's own action reconciles to `state:none` → **false drift alert** ("rotate your token"). The whole design trusts the developer to never forget.
2. **Burst handling: YES, handled, and it errs toward false positives by design.** `collapsedActions = {MEMBER_MOVE, MEMBER_DISCONNECT, MESSAGE_DELETE}` (`contract.js:1`). When `count > 1` for those, `reconcileBurst` consumes up to `count` same-guild/same-action eligible intents ignoring individual targetId (`reconciler.js:20,27-31`). If fewer than `count` intents exist → **drift emitted with original count** (spec: "favors detection over silently accepting an under-ledgered burst"). Count is clamped to `[1, 10000]`; invalid counts (0, negative, >10k, non-int) skip matching and report drift.
3. **TTL/timing: 120s TTL, 120s tolerance — arbitrary, not derived from measured lag.** `ttlMs = 120000` default (`ledger.js:4`), tolerance `120000` (`reconciler.js:6`), both echoed in `reconciliation-rules.md:5`. Both boundaries inclusive (`>=`, `<=`). No comment, benchmark, or doc ties 120s to observed audit-log delivery lag — it reads as a round-number guess. Purge retains expired entries an extra `retentionMs` (also = ttl) so they can still be reported as `expired` near-misses before deletion.
4. **Cross-language parity: schema-identical AND byte-identical — but only over 8 pre-normalized fixtures, and the two libs have genuinely diverged elsewhere.** `tests/cross-language.test.mjs` shells out to both fixture drivers and asserts `assert.equal(js, py)` on raw JSON strings (sorted keys, no indent, UTF-8). That passes. **However:** (a) The Python numeric→name action map has ~20 entries vs JS's ~60 (`__init__.py:10` vs `contract.js:2`) — any raw audit event whose action code is JS-mapped but Python-missing normalizes differently (`UNKNOWN_<n>` in Py). Fixtures dodge this by being pre-normalized. (b) `attach` behavior differs structurally: JS auto-registers gateway listeners and returns `track`+`detach`; Python does neither. So "byte-identical reports" is true for the reconciler core on identical input, **not** end-to-end parity.
5. **Message-level coverage: YES for self-sent, via gateway cross-check — but narrow.** Self-authored `MESSAGE_CREATE` is reconciled: listener filters `message.author.id == botUserId && message.guildId`, synthesizes an event with `targetType:'message'` (`audit-listener.js:8`, Py `__init__.py:125`). A self-message without a prior intent = drift. **DMs are explicitly out of scope** (no guildId). Message edits, reactions, pins-via-content, typing, etc. are out of v1 (`action-type-coverage.md:31`). So message coverage = "did *someone using our token* post in a guild we didn't intend," nothing finer.
6. **Storage adapter: pluggable, interface-based.** `Ledger` takes an `adapter` with `insert/all/remove` (+ optional `has` for O(1) dup-check). `MemoryLedgerAdapter` is default; `SqliteLedgerAdapter` is a drop-in in both langs. Clean seam. Caveat: adapter methods are `async` but Memory/Sqlite impls are synchronous under the hood, and the SQLite adapter has no TTL-aware indexing (purge still does a full `all()` scan).

## Test coverage reality check
- **Counts:** JS 18 tests (13 core + 5 deep); Py 14 (10 core + 4 deep). Plus repo-level `tests/spec.test.mjs` (3 schema assertions) and `tests/cross-language.test.mjs` (1 byte-equality sweep).
- **Well covered:** inclusive tolerance edges, collapsed bursts incl. 10k-entry burst leaving zero entries, under-ledgered burst drift, deterministic partial/expired near-miss ranking, purge boundary + 50k purge under 5s, 500/1000 concurrent reconciliations with no leak, sqlite adapter contract, adversarial set (targetType spoof, count clamp, prototype pollution, clock skew, guild coercion, DM non-drift), the live discord.js raw-shape normalization regression (the 1.0.1 bug).
- **Conspicuously absent / thin:**
  - **No test that a *forgotten intent* on a legitimate action produces the false-positive** — the single biggest real-world failure mode is untested.
  - **No test of the JS action map vs Py action map divergence** — cross-language test only uses pre-normalized fixtures, so the ~40 missing Python action mappings are never exercised.
  - **No end-to-end `attach()` parity test** — nothing catches that Python `attach` doesn't wire listeners.
  - No test for real audit-log delivery lag exceeding 120s (TTL correctness under real timing).
  - Alert dispatch failure/retry (webhook non-200 throws, but no test of partial strategy failure isolation).
  - `benchmarks/results.json` **is checked in** with real numbers (JS ~62k–192k records/s, Py ~25k–32k; SVG charts committed). Legit, but a single machine run, not CI-tracked.

## Gaps / risks / rough edges (worst first)
1. **False-positive by omission (design-level).** Manual intent + "drift = rotate your token" alert means any forgotten wrap screams compromise. No wrapper, no lint, no reconciliation of "action we know we can perform." Highest-severity usability/trust risk.
2. **JS/Py `attach` are not equivalent.** README shows `attach(client)` / `await attach(client)` as symmetric quickstarts, but Python `attach` never registers gateway handlers (`__init__.py:133-138` returns dict, no `.start()`, no `client` event hookup). A Python user copying the README gets a silently dead listener. Real correctness bug vs documented behavior.
3. **Python action map is a ~40-entry subset of JS.** Divergent normalization for many real audit actions; masked by pre-normalized fixtures. Drift reports would differ across languages on live raw events.
4. **120s TTL/tolerance is unjustified.** If Discord audit delivery ever lags >120s (known to happen under load/outage), the intent expires first → legitimate action reports as `expired`/`none` drift. No configurable-per-action tuning surfaced, no empirical basis.
5. **Consume-on-match destroys evidence.** The ledger removes entries on match; it is not itself an audit trail. On a real compromise you only get the drift report + Discord's own logs, not Parity's pre-state.
6. **`executorId == botUserId` gate.** Correct in theory (only the bot's own identity matters), but if a raw event omits/malforms `executorId`, `stringId(undefined)=''` and it's silently dropped — a compromised-token action with a stripped executor field wouldn't reconcile at all. Untested edge.
7. Python `entry not in selected` list-membership check (`__init__.py:93`) is an O(n·m) dict-equality scan — fine at test scale, sloppy at burst scale.
8. SQLite adapter has no purge/index strategy; relies on full-table `all()` load into memory every reconcile.

## Key code excerpts
`index.js:9` — manual intent, no auto-wrap:
```js
export function attach(client, options = {}) { ... listener.start(); return { ..., intent: intent => ledger.record(intent), async track(intent, operation) { await ledger.record(intent); return operation(); }, detach: () => listener.stop() }; }
```
`__init__.py:133-138` — Python attach does NOT start a listener (divergence vs JS):
```python
async def attach(client, **options):
    ... return {'ledger': ledger, 'reconciler': reconciler, 'dispatcher': dispatcher,
    'listener': AuditListener(client, reconciler, dispatcher, options.get('bot_user_id', ...)),
    'intent': ledger.record}   # no .start(), no client event registration
```
`reconciler.js:20,27-31` — burst consume-up-to-count, drift if short:
```js
const burst = collapsedActions.has(canonical.actionType) && canonical.count > 1;
// reconcileBurst: selected = eligible.sort(...).slice(0, event.count);
return selected.length >= event.count ? null : this.report(event, this.nearest(...));
```
`contract.js:1` / `ledger.js:4` — collapsed set + 120s TTL:
```js
export const collapsedActions = new Set(['MEMBER_MOVE','MEMBER_DISCONNECT','MESSAGE_DELETE']);
constructor({ adapter = new MemoryLedgerAdapter(), ttlMs = 120000, ... })
```
Python action map (subset) vs JS (`__init__.py:10`): 20 codes mapped; JS `contract.js:2` maps ~60.

## Suggested next steps
1. **Prove the false-positive.** Write a test/example where a legit action runs *without* an `intent()` and confirm it emits a "rotate token" drift. Then decide on a mitigation: a client proxy/auto-wrap, or a "known-safe action" allowlist, so the tool doesn't cry wolf.
2. **Fix Python `attach` parity** (register gateway/message handlers or clearly document that Python is manual-dispatch) and **reconcile the two action maps** — generate both from one shared source so they can't drift.
3. **Justify or make configurable the 120s window** — pull real audit-log delivery-lag numbers, or expose per-action TTL/tolerance, and add a test simulating >120s lag.
4. **Add a divergence guard to CI** — a cross-language test over *raw* (un-normalized) audit events, not just the 8 pre-normalized fixtures, so map/normalization drift fails the build.
