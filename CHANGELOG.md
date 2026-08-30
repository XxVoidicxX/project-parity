# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [1.6.0] - 2026-08-29

### Changed

- Built-in owner alerts and onboarding confirmations are now Discord Components V2 Container cards with the required `IS_COMPONENTS_V2` flag, Text Display content, and an explicit containment instruction.
- Both runtimes preserve result-derived self-message tracking for the V2 card. Python uses its client’s normal V2 send path when available and a raw Discord Message Create fallback when the client library lacks V2 flag support.

### Verified

- Offline payload and raw-fallback tests pass in both runtimes. Disposable live JavaScript and Python doctors both passed 9/9, verifying the returned message’s V2 flag, Container shape, and reconciliation.

## [1.5.0] - 2026-08-29

### Added

- `parity` CLI in JavaScript and Python with help, init, status, check, health, logs, clear-logs, settings, and reset commands.
- Attached runtimes now keep bounded token-free local status and lifecycle logs under `.parity/`, with a heartbeat for meaningful process health checks.
- Console output is configurable as `off`, `drift`, or `all`, defaults to quiet, and can be toggled at runtime for PM2 or terminal workflows.

## [1.4.0] - 2026-08-29

### Added

- JavaScript and Python onboarding doctors validate bot login, guild and audit-log access, private writable alert channels, optional owner visibility, and an end-to-end tracked test alert.
- `testOwnerAlert()` / `test_owner_alert` sends the confirmation through result-derived tracking, preserving self-message coverage without an alert loop.
- Local developer-profile tests cover valid private setup, public alert channels, missing send permission, and test-alert reconciliation in both runtimes. Disposable live doctors passed all eight checks in JavaScript and Python.

## [1.3.0] - 2026-08-29

### Added

- `attach()` now accepts `alertChannelId` / `alertUserId` in JavaScript and `alert_channel_id` / `alert_user_id` in Python. It posts a bounded plain-language drift incident message to a private Discord channel without requiring custom alert code.
- `DiscordChannelAlertStrategy` and `formatDriftAlert` / `format_drift_alert` are public in both implementations. Their human-facing text is asserted byte-for-byte across languages.
- Root `AGENTS.md` gives coding agents the required private owner-alert configuration, action-recording rules, and incident-response steps.
- The disposable Discord target matrix now proves that an owner alert is delivered once and that its bot-authored message reconciles instead of creating an alert loop.

## [1.2.0] - 2026-08-29

### Added

- `OperationJournal` in JavaScript and Python records a bounded, normalized lifecycle for code intent, REST success/rejection, Discord observation, match/drift, duplicate suppression, and non-bot events. `attach()` exposes it as `journal` and accepts `onEvent` for external observability.
- `reconcileDetailed` / `reconcile_detailed` identify every ledger correlation ID consumed by an audit event, including collapsed bursts, while preserving the existing report-returning reconciliation API.
- Cross-language and runtime tests assert journal record parity, matched correlation IDs, failure cleanup, bounded retention, and ignored external events.

## [1.1.0] - 2026-08-27

### Added

- A shared `target-extraction-fixtures.json` contract covers overwrite composites, member actions, message delete/bulk/pin, invite codes, voice status, and AutoMod targets; JavaScript and Python projections are asserted byte-for-byte.
- Ledger intents may include an optional validated `count` from 1 through 10,000. One `MESSAGE_BULK_DELETE` call now reconciles only when its exact channel and message count match the audit entry.
- JavaScript auto-wrap exposes `getAutoWrapCoverage()`, reports unsupported manager objects and observed known-unsupported mutations, accepts an `onUnsupportedCall` hook, and can explicitly wrap standalone managers such as `WebhookClient`.
- A disposable `live-test:targets` harness verifies Discord bulk-delete count reconciliation and reports unaudited same-app single-message deletes as unavailable.

### Fixed

- Action-specific audit normalization no longer mistakes a deleted-message author for the message, a channel-overwrite channel for the overwritten entity, or a null pin target for a message ID. Targetless disconnect/prune events now have stable guild targets.
- Auto-wrap now unregisters its `guildCreate` listener and restores original manager objects on detach.
- Audit action 192 is named `VOICE_CHANNEL_STATUS_CREATE`, matching Discord's current audit-log table and discord.js 14.27.0. Documentation notes Discord's conflicting April 2026 changelog wording.

## [1.0.2] - 2026-08-27

### Fixed

- Corrected the canonical Discord action map: application-command permissions use code 121 (not 120), and current soundboard, quarantine, monetization, onboarding, home-settings, and voice-status actions are included. A test now compares the spec map with the installed discord.js enum, with the documented code-192 naming exception.
- JavaScript auto-wrap now recognizes discord.js's real `RoleManager`, removes pre-call intents when REST operations fail, and records create targets from returned Discord objects.
- Result-derived `track()` in both languages now registers an in-flight operation before the API call. Gateway listeners wait only for active generated-ID operations (bounded to five seconds), closing the create/message race confirmed by live tests.
- Python `attach()` now works with plain `discord.Client` by composing and restoring `on_*` handlers, while also supporting listener-based clients. It registers discord.py and py-cord audit event variants and deduplicates duplicate audit IDs.
- Python audit normalization now handles raw py-cord entries, derives timestamps from audit snowflakes, converts string counts, and uses canonical target types instead of cache-dependent class names.
- The Python example now uses `intents.moderation` and the public `attach()` path; its prior `guild_audit_log` property and unreachable self-message branch were invalid.
- The live JavaScript harness now isolates reports by action, target, and start index; waits for setup events; exits nonzero on failed assertions; and detaches before cleanup. Prior 1.0.1 results contained false passes/failures from loose matching.

### Added

- Unit coverage for JS auto-wrap, failed-operation cleanup, generated-ID races, Python registration/detach, plain-client handler composition, and action-map/runtime consistency.
- A disposable-resource Python live harness (`tools/live-python-test.py`). On 2026-08-27 the corrected JS matrix passed 14/14 and the isolated discord.py 2.5.2 matrix passed 5/5 against VSH Codebase; all temporary resources were removed.

## [1.0.1] - 2026-08-08

### Fixed

- Normalization bug in AuditListener: discord.js delivers `action` as a numeric code and `actionType` as a generic category string ("Create", "Update"). The listener now prefers the numeric `action` field so it maps to the canonical name (for example `CHANNEL_UPDATE`) via the action-name table. The previous behavior passed the generic string through unchanged, causing false-positive drift for legitimately recorded actions.
- `targetType` from discord.js arrives capitalized ("Channel"). The normalizer now lowercases it so reconciler matching is case-consistent.
- MEMBER_MOVE and MEMBER_DISCONNECT target extraction now reads from `entry.extra.channel.id` first, matching where discord.js places the voice channel ID for those action types.
- Reconciler `rank()` and `report()` now compute expiry relative to `event.occurredAt` rather than the reconciler clock, closing a clock-skew false-authorization window.
- Ledger `record()` is now serialized with a write queue, eliminating a concurrent-insertion race on the duplicate-ID check.
- Reconciler canonicalizes and clamps the incoming count field; count values of 0, -1, or above MAX_AUDIT_COUNT (10000) are treated as invalid and report drift rather than consuming ledger entries or panicking.
- Ledger `record()` uses `Object.prototype.hasOwnProperty` for field extraction, preventing prototype-polluted objects from injecting unexpected fields into stored entries.

### Added

- Regression test using exact raw discord.js field shapes from the live test in VSH Codebase confirming actionType and targetType normalization in both JavaScript and Python.
- Live-channel-normalization cross-language fixture with rawAuditEvents support in both fixture drivers.
- Hardening test covering all 10 attack surfaces: MEMBER_MOVE/DISCONNECT extraction, count clamping, burst target isolation, clock-skew expiry, ledger-poisoning orphan lifecycle, guild ID type coercion, prototype pollution, DM non-drift, and concurrent record() race.
- 50,000-entry purge performance test (must complete within 5 seconds).

## [1.0.0] - 2026-08-08

### Added

- Seeded property tests, tolerance-boundary matrices, 10,000-entry burst tests, and concurrent reconciliation checks in JavaScript and Python.
- Three additional shared cross-language fixtures for burst matching, timing misses, and guild isolation.
- Real JavaScript and Python benchmark scripts, a stable JSON results schema, and standalone SVG charts.
- A safe live Discord harness that skips when no runtime token is configured.
- Release documentation, test report, schema-versioning guidance, and this changelog.

### Changed

- Memory-ledger duplicate checks now use constant-time adapter lookups when available.
