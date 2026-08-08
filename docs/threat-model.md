# Threat Model

## Security boundary

Parity detects actions observed through Discord that were not predeclared by this process. It cannot prevent use of a leaked token, recover a token, identify the hostile host, or observe actions Discord does not audit-log or gateway-deliver. Treat every high-confidence drift report as an incident: rotate the token, revoke deployment secrets, and investigate process and audit-log history.

## Design Decisions

The 120-second window is deliberately conservative for audit delivery jitter. Automated tests use a deterministic clock; production deployments should record gateway receipt and audit-entry timestamp telemetry. No live Discord tenant was available during this release build, so p50/p95 empirical delivery lag is **not yet measured**; operators must collect it before relying on a tighter tolerance. Collapsed audit entries accept only the same number of action intents, never a single wildcard intent. Exact reconciliation requires target type equality, and intents cannot authorize an audit event after their expiry time. The ledger rejects duplicate correlation IDs and unknown `UNKNOWN_<n>` actions, avoiding overwrite-based masking and unreviewed numeric-action aliases.

## Adversarial Findings

The test suites in both runtimes exercise these evasion attempts: an audit action one millisecond outside tolerance; spoofed `UNKNOWN_<n>` action aliases; collapsed bursts with too few intents; equal IDs with mismatched target types; duplicate correlation-ID insertion; and expired intents presented as authorization. These result in drift or a rejected ledger write. Reconciliation is serialized so concurrent observations cannot consume the same intent twice.

We also encode the ledger-poisoning attempt: a hostile process that can pre-write the exact intent will suppress the corresponding report. This is not a detector bug within Parity's stated trust boundary—the ledger writer is the protected host process—but it remains a material deployment risk. Protect the durable ledger and runtime credentials with OS/process isolation and use external alerting.

## Residual risks

An attacker who can modify the host ledger or suppress its gateway connection can evade this layer. Use durable storage, least-privilege host access, monitoring for disconnects, and external alert delivery. A hostile process that creates matching ledger entries can evade attribution; token rotation remains mandatory.
