# Capturing audit fixtures

This optional advanced workflow captures real `guildAuditLogEntryCreate` shapes for a Discord or discord.js version that your bot uses. It is intended to detect compatibility changes before they reach production.

The capture command reads `DISCORD_BOT_TOKEN` and `PARITY_GUILD_ID` from the environment or an ignored `.env` file. It never writes either credential. Snowflake-like identifiers are replaced consistently with `id-1`, `id-2`, and so on; event timestamps are replaced with deterministic values; change values are reduced to their types.

```powershell
node tools/capture-audit-fixtures.mjs --count 25 --output parity-spec/observed-fixtures/discordjs-audit-shapes.json
```

Generate safe actions in a dedicated test guild while the command is running, then review the resulting JSON before committing it. The capture includes only action codes, generic action and target types, anonymized relationships, counts, and change-key/type metadata.

Use a captured corpus as an upgrade review artifact. Add representative sanitized shapes to `parity-spec/fixtures/` only after pairing each shape with deterministic intents and cross-language assertions.
