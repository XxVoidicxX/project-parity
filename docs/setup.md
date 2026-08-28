# Setup

Grant the bot `VIEW_AUDIT_LOG`, enable `GUILD_MODERATION` (`intents.moderation` in discord.py), and attach Parity after client construction. Persist the ledger with `SqliteLedgerAdapter` in production; the default memory adapter is intended for simple deployments and tests. Record target-known actions before the outbound call. For Discord-generated IDs, use result-derived `track`; JavaScript can additionally opt into `attachAutoWrap` for supported guild managers.

## Live Discord check

Use a dedicated test tenant and rotate or reset the bot token before this check. Never place a token in source code, a fixture, a command history that will be shared, or a commit.

Set `DISCORD_BOT_TOKEN` and `PARITY_GUILD_ID` in the environment, or create a local `.env` file. The `.env` file and `*.token` files are ignored by Git.

```powershell
$env:DISCORD_BOT_TOKEN = 'replace-with-a-fresh-token'
$env:PARITY_GUILD_ID = 'dedicated-test-guild-id'
npm run live-test
npm run live-test:py
```

The harnesses create only `parity-test-*` / `parity-py-test-*` channels, roles, and webhooks, exercise drift and reconciliation, detach listeners, and delete their resources in `finally`/cleanup paths. Use a dedicated test guild. The Python check should run in an isolated environment containing `discord.py`; installing py-cord and discord.py together is unsupported because both own the `discord` import namespace. Without credentials, each harness prints a skip message and exits with status 0.
