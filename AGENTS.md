# Project Parity integration guide for coding agents

Parity reports Discord actions performed by the bot identity that this process did not declare. Treat every high-confidence drift report as a possible token compromise.

## Required integration

1. Create a private Discord channel such as `#parity-alerts`. Only the bot owner and trusted responders should be able to read it.
2. Set `PARITY_ALERT_CHANNEL_ID` to that channel's ID. Optionally set `PARITY_ALERT_USER_ID` to mention its owner.
3. Attach Parity once, after creating the Discord client:

```js
const parity = attach(client, {
  alertChannelId: process.env.PARITY_ALERT_CHANNEL_ID,
  alertUserId: process.env.PARITY_ALERT_USER_ID,
});
```

```py
parity = await attach(
    client,
    alert_channel_id=os.environ['PARITY_ALERT_CHANNEL_ID'],
    alert_user_id=os.getenv('PARITY_ALERT_USER_ID'),
)
```

4. Give the bot `VIEW_AUDIT_LOG`, enable moderation audit events, and enable guild message events when self-message coverage is needed.
5. In JavaScript, prefer `autoWrap: true` in `attach(...)` for supported channel, role, member, and ban manager calls; inspect `getAutoWrapCoverage()` and `parity logs` for `auto-wrap-unsupported` records. For unsupported JavaScript APIs and all Python outbound actions, use `intent(...)`; use `track(...)` when Discord generates the target ID.
6. Run `npm run doctor -- --send-test` or `parity-doctor --send-test` before deployment. Fix every failed doctor check; the test message must reconcile successfully.
7. Run `parity check` after the bot starts. Keep console mode `off` under PM2 unless incident output is wanted; use `parity settings console drift` for drift-only process logs.

## Response to an alert

1. Rotate the bot token and revoke deployed copies.
2. Inspect the reported action in Discord's audit log and inspect active bot deployments.
3. Preserve the alert and journal records for investigation.

Parity sends its own Components V2 Container alert and tracks that message as a deliberate self-message. Do not remove that behavior or add a second alert sender that bypasses Parity tracking, or a bot can alert about its own alert.

## Safety rules

- Never put a token in source, tests, fixtures, commit messages, or documentation.
- Never configure an alert channel that untrusted guild members can read.
- Do not silently suppress a drift report. If a custom dispatcher is used, it must preserve a human-visible owner alert.
- Run `npm test` after changes. Use the live harnesses only with a dedicated test guild and ignored credentials.
