# Threat Model

## Security boundary

Parity detects actions observed through Discord that were not predeclared by this process. It cannot prevent use of a leaked token, recover a token, identify the hostile host, or observe actions Discord does not audit-log or gateway-deliver. Treat every high-confidence drift report as an incident: rotate the token, revoke deployment secrets, and investigate process and audit-log history.

## Design Decisions

The 120-second window is deliberately conservative for audit delivery jitter. Automated tests use a deterministic clock; production deployments should record gateway receipt and audit-entry timestamp telemetry. No live Discord tenant was available during this release build, so p50/p95 empirical delivery lag is **not yet measured**; operators must collect it before relying on a tighter tolerance. Collapsed audit entries accept only the same number of action intents, never a single wildcard intent.

## Residual risks

An attacker who can modify the host ledger or suppress its gateway connection can evade this layer. Use durable storage, least-privilege host access, monitoring for disconnects, and external alert delivery. A hostile process that creates matching ledger entries can evade attribution; token rotation remains mandatory.
