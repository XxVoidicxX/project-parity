# Action Type Coverage

Parity normalizes Discord audit-log action names to the names below. `Gateway` actions are delivered by `GUILD_AUDIT_LOG_ENTRY_CREATE` and reconciled directly. `REST fallback` means the action is audit-logged but a gateway listener may not receive historical entries after downtime; an optional consumer can replay `guild.fetchAuditLogs()`. `Not audit-logged` needs a dedicated gateway observation and intent wrapper.

| Actions | Classification | Handling |
|---|---|---|
| `GUILD_UPDATE` | Gateway | Exact target: guild ID |
| `CHANNEL_CREATE`, `CHANNEL_UPDATE`, `CHANNEL_DELETE` | Gateway | Exact target: channel ID |
| `CHANNEL_OVERWRITE_CREATE`, `CHANNEL_OVERWRITE_UPDATE`, `CHANNEL_OVERWRITE_DELETE` | Gateway | Exact target: overwrite target ID |
| `MEMBER_KICK`, `MEMBER_PRUNE`, `MEMBER_BAN_ADD`, `MEMBER_BAN_REMOVE`, `MEMBER_UPDATE`, `MEMBER_ROLE_UPDATE`, `MEMBER_MOVE`, `MEMBER_DISCONNECT`, `BOT_ADD` | Gateway | Exact target except collapsed burst rules for move/disconnect |
| `ROLE_CREATE`, `ROLE_UPDATE`, `ROLE_DELETE` | Gateway | Exact target: role ID |
| `INVITE_CREATE`, `INVITE_UPDATE`, `INVITE_DELETE` | Gateway | Target supplied by Discord; use invite code ID when available |
| `WEBHOOK_CREATE`, `WEBHOOK_UPDATE`, `WEBHOOK_DELETE` | Gateway | Exact target: webhook ID |
| `EMOJI_CREATE`, `EMOJI_UPDATE`, `EMOJI_DELETE` | Gateway | Exact target: emoji ID |
| `STICKER_CREATE`, `STICKER_UPDATE`, `STICKER_DELETE` | Gateway | Exact target: sticker ID |
| `INTEGRATION_CREATE`, `INTEGRATION_UPDATE`, `INTEGRATION_DELETE` | Gateway | Exact target: integration ID |
| `STAGE_INSTANCE_CREATE`, `STAGE_INSTANCE_UPDATE`, `STAGE_INSTANCE_DELETE` | Gateway | Exact target: stage instance ID |
| `GUILD_SCHEDULED_EVENT_CREATE`, `GUILD_SCHEDULED_EVENT_UPDATE`, `GUILD_SCHEDULED_EVENT_DELETE` | Gateway | Exact target: event ID |
| `THREAD_CREATE`, `THREAD_UPDATE`, `THREAD_DELETE` | Gateway | Exact target: thread ID |
| `APPLICATION_COMMAND_PERMISSION_UPDATE` | Gateway | Exact target: command ID |
| `AUTO_MODERATION_RULE_CREATE`, `AUTO_MODERATION_RULE_UPDATE`, `AUTO_MODERATION_RULE_DELETE`, `AUTO_MODERATION_BLOCK_MESSAGE`, `AUTO_MODERATION_FLAG_TO_CHANNEL`, `AUTO_MODERATION_USER_COMMUNICATION_DISABLED`, `AUTO_MODERATION_QUARANTINE_USER` | Gateway | Exact target where Discord supplies one; action-only partial diagnosis otherwise |
| `ONBOARDING_PROMPT_CREATE`, `ONBOARDING_PROMPT_UPDATE`, `ONBOARDING_PROMPT_DELETE`, `ONBOARDING_CREATE`, `ONBOARDING_UPDATE` | Gateway | Exact target: prompt/guild ID |
| `HOME_SETTINGS_CREATE`, `HOME_SETTINGS_UPDATE` | Gateway | Exact target: guild ID |
| `VOICE_CHANNEL_STATUS_UPDATE`, `VOICE_CHANNEL_STATUS_DELETE` | Gateway | Exact target: channel ID |
| `SOUNDBOARD_SOUND_CREATE`, `SOUNDBOARD_SOUND_UPDATE`, `SOUNDBOARD_SOUND_DELETE` | Gateway | Exact target when supplied |
| `CREATOR_MONETIZATION_REQUEST_CREATED`, `CREATOR_MONETIZATION_TERMS_ACCEPTED` | Gateway | Monitor when emitted; target semantics are Discord-controlled |
| `MESSAGE_DELETE`, `MESSAGE_BULK_DELETE`, `MESSAGE_PIN`, `MESSAGE_UNPIN` | Gateway | Burst rules apply to delete; target can be unavailable for bulk delete |
| Any documented audit action absent above | REST fallback | Preserve as `UNKNOWN_<number>` until a mapping is added and replay via REST if needed |
| Plain `MESSAGE_CREATE` | Not audit-logged | Self-authored gateway cross-check |
| Message edit, reaction add/remove, typing, presence, voice state, interactions, DMs | Not audit-logged | Out of v1 scope unless application wraps and observes the matching gateway event |

Gateway delivery requires the `GUILD_MODERATION` / audit-log gateway capability exposed by the Discord library and the bot permission `VIEW_AUDIT_LOG`. REST fallback is a recovery mechanism, not a substitute for live detection. Numeric mappings are maintained in `audit-action-map.json` and were cross-checked against Discord's audit-log event table and discord.js 14.27.0 on 2026-08-27.
