# Reconciliation Rules

## Canonical time and identifiers

All IDs are decimal strings. Timestamps are UTC ISO-8601 strings with millisecond precision (`YYYY-MM-DDTHH:mm:ss.sssZ`). Implementations inject a clock for deterministic tests. The default ledger TTL is 120 seconds. An intent is eligible from its timestamp through `expiresAt`, inclusive. An audit event is compared against the intent timestamp using an absolute tolerance of 120 seconds; expired entries are retained only long enough to report an `expired` near miss, then purged.

## Exact matching

Normalize an audit event to `actionType`, `targetId`, `targetType`, and `guildId`. An intent matches when `actionType`, `targetId`, and `guildId` are exactly equal and the audit event occurs within tolerance. Target type is diagnostic and does not reject an otherwise exact match because Discord omits or changes target object shapes for several action classes. The oldest eligible exact intent is consumed. Each intent can reconcile one audit count unit.

## Partial and expired matches

If no exact entry exists, choose the nearest ledger entry in the same guild by a deterministic score: matching action contributes 4, matching target contributes 2, unexpired contributes 1, then absolute timestamp distance, then correlation ID lexical order. Its state is `partial` if unexpired and `expired` if expired. A drift report contains a projection of this entry, never arbitrary metadata. With no candidate, the state is `none`.

## Collapsed audit entries

Discord may collapse rapid `MEMBER_MOVE`, `MEMBER_DISCONNECT`, and `MESSAGE_DELETE` actions into one audit entry with `count > 1`, sometimes with a target ID that represents only one affected entity. For these action types, reconciliation consumes up to `count` same-guild, same-action eligible intents. If the number consumed is at least `count`, no drift is emitted. Otherwise one drift is emitted with the original count and a partial/none ledger state. A count of one follows ordinary exact matching. This intentionally favors detection over silently accepting an under-ledgered burst.

## Message sends

Plain message sends are not audit logged. Implementations reconcile self-authored `MESSAGE_CREATE` gateway events (`author.id == bot user ID`) as `MESSAGE_CREATE` intents using the message ID and guild ID. A self-message without an intent is drift. Direct messages have no guild ID and are outside the version 1 contract.

## Unknown audit actions

Unknown numeric actions normalize to `UNKNOWN_<number>`. They remain observable but are never treated as legitimate without an exact corresponding ledger intent.
