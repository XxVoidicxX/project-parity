# Setup

Grant the bot `VIEW_AUDIT_LOG`, enable `GUILD_MODERATION` (`intents.moderation` in discord.py), and attach Parity after client construction. Persist the ledger with `SqliteLedgerAdapter` in production; the default memory adapter is intended for simple deployments and tests. Set JavaScript `autoWrap: true` to ledger supported guild-manager calls automatically. For unsupported JavaScript APIs and all Python outbound actions, record target-known actions before the outbound call; use result-derived `track` for Discord-generated IDs.

## Owner alerts

Create a private channel visible only to the bot owner and responders. Configure its ID as `alertChannelId` in JavaScript or `alert_channel_id` in Python; optionally configure `alertUserId` / `alert_user_id`. Parity then sends a plain-language Discord message for every drift report. Do not use a public channel, and do not replace this strategy with a dispatcher that only logs JSON.

## Canonical targets

Discord's audit `target_id` is not always the object passed to the REST call. Use these v1.3 targets when recording manual intents:

| Action | `targetId` | `targetType` | Extra intent field |
| --- | --- | --- | --- |
| `MESSAGE_DELETE` | Channel ID | `channel` | None; Discord does not expose the deleted message ID in audit logs |
| `MESSAGE_BULK_DELETE` | Channel ID | `channel` | `count`: exact number of messages in the request |
| `MESSAGE_PIN`, `MESSAGE_UNPIN` | Message ID | `message` | None |
| `CHANNEL_OVERWRITE_*` | `<channelId>:<roleOrMemberId>` | `overwrite` | None |
| `MEMBER_MOVE` | Destination channel ID | `channel` | One intent per moved member, or an explicit aggregate `count` |
| `MEMBER_DISCONNECT`, `MEMBER_PRUNE` | Guild ID | `guild` | One intent per affected member for collapsed disconnects |
| `INVITE_*` | Invite code | `invite` | None |
| `VOICE_CHANNEL_STATUS_*` | Channel ID | `channel` | None |

JavaScript auto-wrap is deliberately partial. Set `autoWrap: true` in `attach(...)`, then call `parity.getAutoWrapCoverage()` to inspect wrapped managers, unsupported manager objects, and observed calls to known unsupported mutations such as role/channel position updates or member pruning. Those known calls are persisted as `auto-wrap-unsupported` journal/runtime records. Use `autoWrap: { onUnsupportedCall: call => ... }` to also route them into application logging. Standalone `WebhookClient` instances can be wrapped explicitly with `parity.wrapManager(webhookClient, guildId)`. Python outbound calls remain manual in v1.7.

## Live Discord check

Use a dedicated test tenant and rotate or reset the bot token before this check. Never place a token in source code, a fixture, a command history that will be shared, or a commit.

Set `DISCORD_BOT_TOKEN` and `PARITY_GUILD_ID` in the environment, or create a local `.env` file. The `.env` file and `*.token` files are ignored by Git.

```powershell
$env:DISCORD_BOT_TOKEN = 'replace-with-a-fresh-token'
$env:PARITY_GUILD_ID = 'dedicated-test-guild-id'
npm run live-test
npm run live-test:py
npm run live-test:targets
```

The harnesses create only `parity-test-*`, `parity-py-test-*`, and `parity-target-*` channels, roles, and webhooks, exercise drift and reconciliation, detach listeners, and delete their resources in `finally`/cleanup paths. `live-test:targets` verifies bulk-delete audit count reconciliation; Discord does not audit deletion of a same-app webhook message, so it explicitly reports that single-delete case as unavailable rather than passing it. Use a dedicated test guild. The Python check supports discord.py and py-cord lifecycle paths, but do not install both in one environment because both own the `discord` import namespace. Without credentials, each harness prints a skip message and exits with status 0.
