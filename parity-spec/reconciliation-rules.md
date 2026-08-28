# Reconciliation Rules

## Canonical time and identifiers

All IDs are decimal strings. Timestamps are UTC ISO-8601 strings with millisecond precision (`YYYY-MM-DDTHH:mm:ss.sssZ`). Implementations inject a clock for deterministic tests. The default ledger TTL is 120 seconds. An intent is eligible from its timestamp through `expiresAt`, inclusive. An audit event is compared against the intent timestamp using an absolute tolerance of 120 seconds; expired entries are retained only long enough to report an `expired` near miss, then purged.

## Exact matching

Normalize an audit event to `actionType`, `targetId`, `targetType`, and `guildId`. An intent matches only when all four fields are exactly equal, the event occurs within tolerance, and the intent has not expired at the event time; both tolerance and expiry boundaries are inclusive. The oldest eligible exact intent is consumed. Each intent can reconcile one audit count unit. This rejects an action against a differently typed target rather than allowing an ID collision to mask drift.

## Partial and expired matches

If no exact entry exists, choose the nearest ledger entry in the same guild by a deterministic score: matching action contributes 4, matching target contributes 2, unexpired contributes 1, then absolute timestamp distance, then correlation ID lexical order. Its state is `partial` if unexpired and `expired` if expired. A drift report contains a projection of this entry, never arbitrary metadata. With no candidate, the state is `none`.

## Collapsed audit entries

Discord may collapse rapid `MEMBER_MOVE`, `MEMBER_DISCONNECT`, and `MESSAGE_DELETE` actions into one audit entry with `count > 1`, sometimes with a target ID that represents only one affected entity. For these action types, reconciliation consumes up to `count` same-guild, same-action eligible intents. If the number consumed is at least `count`, no drift is emitted. Otherwise one drift is emitted with the original count and a partial/none ledger state. A count of one follows ordinary exact matching. This intentionally favors detection over silently accepting an under-ledgered burst.

## Message sends

Plain message sends are not audit logged. Implementations reconcile self-authored `MESSAGE_CREATE` gateway events (`author.id == bot user ID`) as `MESSAGE_CREATE` intents using the message ID and guild ID. Because Discord assigns the message ID, result-derived `track` registers the operation as in flight, records the returned ID, and allows the listener to wait up to five seconds before reconciliation. A self-message without an intent is drift. Direct messages have no guild ID and are outside the version 1 contract.

## Unknown audit actions

Unknown numeric actions normalize to `UNKNOWN_<number>`. They remain observable but are never treated as legitimate without an exact corresponding ledger intent.

## Canonical fixture output

The shared fixture drivers use the fixture `clock` for every generated report timestamp and print one UTF-8 JSON array with no indentation. Object keys are recursively sorted in Unicode lexical order; arrays retain input/event order; timestamps are normalized to UTC millisecond ISO-8601; and no host-specific metadata is emitted. The cross-language test compares these complete JSON byte strings. Fixtures contain already-normalized incoming audit or self-message events, so listener-library object-shape normalization is tested separately.
