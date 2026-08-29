# Threat Model

## Security boundary

Parity detects actions observed through Discord that were not predeclared by this process. It cannot prevent use of a leaked token, recover a token, identify the hostile host, or observe actions Discord does not audit-log or gateway-deliver. Treat every high-confidence drift report as an incident: rotate the token, revoke deployment secrets, and investigate process and audit-log history.

## Design Decisions

The 120-second window is deliberately conservative for audit delivery jitter. Automated tests use a deterministic clock; production deployments should record gateway receipt, audit-entry timestamp, and REST duration telemetry. Live checks were performed in 1.0.2, but their local-clock/snowflake deltas were not a valid p50/p95 lag distribution, so the timing policy remains unmeasured. Collapsed audit entries require exactly the observed number of intent units, never a wildcard. A bulk-message-delete intent must carry the exact message count. Exact reconciliation requires target type equality, and intents cannot authorize an audit event after expiry. The ledger rejects duplicate correlation IDs, malformed counts, and unknown `UNKNOWN_<n>` intents.

Discord does not expose equally precise targets for every action. A single message-delete audit entry exposes the author and channel but not the message ID, so Parity canonicalizes it to the channel. Disconnect/prune events can omit affected users and are canonicalized to the guild. This prevents impossible exact-message/user matching but permits same-action substitution inside the timing window. Counts reduce that risk but do not remove it; treat these action types as lower-granularity evidence.

## Adversarial Findings

The test suites in both runtimes exercise these evasion attempts: an audit action one millisecond outside tolerance; spoofed `UNKNOWN_<n>` action aliases; collapsed bursts with too few intents; bulk-delete count mismatch; equal IDs with mismatched target types; duplicate correlation-ID insertion; and expired intents presented as authorization. These result in drift or a rejected ledger write. Reconciliation is serialized so concurrent observations cannot consume the same intent twice.

We also encode the ledger-poisoning attempt: a hostile process that can pre-write the exact intent will suppress the corresponding report. This is not a detector bug within Parity's stated trust boundary—the ledger writer is the protected host process—but it remains a material deployment risk. Protect the durable ledger and runtime credentials with OS/process isolation and use external alerting.

## Residual risks

An attacker who can modify the host ledger or suppress its gateway connection can evade this layer. Use durable storage, least-privilege host access, monitoring for disconnects, and external alert delivery. A hostile process that creates matching ledger entries can evade attribution; token rotation remains mandatory.
