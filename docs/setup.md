# Setup

Grant the bot `VIEW_AUDIT_LOG`, enable the audit-log gateway capability required by your Discord library, and attach Parity after client construction. Persist the ledger with `SqliteLedgerAdapter` in production; the default memory adapter is intended for simple deployments and tests. Before every outbound audited Discord action call `await parity.intent({ actionType, targetId, targetType, guildId })`.
