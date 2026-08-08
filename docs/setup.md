# Setup

Grant the bot `VIEW_AUDIT_LOG`, enable the audit-log gateway capability required by your Discord library, and attach Parity after client construction. Persist the ledger with `SqliteLedgerAdapter` in production; the default memory adapter is intended for simple deployments and tests. Before every outbound audited Discord action call `await parity.intent({ actionType, targetId, targetType, guildId })`.

## Live Discord check

Use a dedicated test tenant and rotate or reset the bot token before this check. Never place a token in source code, a fixture, a command history that will be shared, or a commit.

Set `DISCORD_BOT_TOKEN` in the environment, or create a local `.env` file containing only `DISCORD_BOT_TOKEN=...`. The `.env` file and `*.token` files are ignored by Git.

```powershell
$env:DISCORD_BOT_TOKEN = 'replace-with-a-fresh-token'
node tools/live-parity-check --guild-id YOUR_GUILD_ID --target-id EXISTING_CHANNEL_ID
```

The harness is read-mostly. It connects, registers the audit-log event handler, records a `CHANNEL_UPDATE` intent, and waits for an audit event. While it is waiting, edit the topic of the identified disposable test channel once, then optionally restore the old topic. This is the only operator action required. Do not use a production channel. The harness exits cleanly with a no-drift result when that event reconciles. Without `DISCORD_BOT_TOKEN`, it prints a skip message and exits with status 0.
