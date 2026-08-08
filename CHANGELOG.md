# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-08

### Added

- Seeded property tests, tolerance-boundary matrices, 10,000-entry burst tests, and concurrent reconciliation checks in JavaScript and Python.
- Three additional shared cross-language fixtures for burst matching, timing misses, and guild isolation.
- Real JavaScript and Python benchmark scripts, a stable JSON results schema, and standalone SVG charts.
- A safe live Discord harness that skips when no runtime token is configured.
- Release documentation, test report, schema-versioning guidance, and this changelog.

### Changed

- Memory-ledger duplicate checks now use constant-time adapter lookups when available.
