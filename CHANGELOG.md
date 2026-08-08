# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

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
