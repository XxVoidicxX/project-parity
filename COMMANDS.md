# Parity Commands

Parity provides the same runtime CLI in the JavaScript and Python packages. It reads local token-free runtime state from `.parity/` by default; it does not connect to Discord or read a bot token for normal commands.

## Choose one invocation style

| Situation | Command form |
| --- | --- |
| Installed JavaScript or Python package | `parity <command>` |
| Repository, JavaScript | `npm run parity -- <command>` |
| Repository, Python | `cd parity-py` then `python -m parity_py.cli <command>` |
| Different bot working directory | Set `PARITY_RUNTIME_DIR` for both the bot and the CLI |

PowerShell example with a shared runtime directory:

```powershell
$env:PARITY_RUNTIME_DIR = "C:\bots\my-bot\.parity"
parity status
```

## Command reference

| Command | Arguments | What it does | Example |
| --- | --- | --- | --- |
| `parity help` | None | Prints the command reference. `--help` and `-h` are aliases. | `parity help` |
| `parity init` | Optional `--json` | Creates `.parity/settings.json` with quiet console output and a 500-record log limit. It does not start the bot. | `parity init --json` |
| `parity status` | Optional `--json` | Shows the latest attached/detached runtime state. Exits 1 when no runtime state exists. | `parity status --json` |
| `parity check` | None | Validates that the runtime is attached and fresh using the default 60-second window. Exits 1 when unhealthy. | `parity check` |
| `parity health` | `--max-age <seconds>`, optional `--json` | Same health check with a custom freshness window. The value must be a whole number of at least 1. | `parity health --max-age 120 --json` |
| `parity logs` | `--limit <number>`, `--drift`, `--json` | Shows up to 50 recent lifecycle records by default. `--drift` keeps only drift records. | `parity logs --drift --limit 20 --json` |
| `parity clear-logs` | None | Clears local lifecycle records but keeps settings and status. | `parity clear-logs` |
| `parity settings show` | Optional `--json` | Shows `console` and `logLimit` settings. This is also the default `settings` subcommand. | `parity settings show` |
| `parity settings console` | One of `off`, `drift`, `all` | Chooses terminal output from the running bot. `off` is quiet; `drift` emits only incidents; `all` emits Parity lifecycle output. | `parity settings console drift` |
| `parity settings log-limit` | Whole number from 1 through 10,000 | Limits retained local lifecycle records. Oldest records are dropped first. | `parity settings log-limit 1000` |
| `parity reset` | None | Removes the local runtime state directory. Use only when you want a clean local start. | `parity reset` |

Unknown commands, missing values, non-integer numeric values, and invalid settings exit with status 1 and print a `Parity CLI:` error. `logs` returns an empty list rather than failing when there are no records.

## Onboarding doctor

The doctor is separate from the local CLI because it logs into Discord and checks the configured guild and private alert channel. It requires `DISCORD_BOT_TOKEN`, `PARITY_GUILD_ID`, and `PARITY_ALERT_CHANNEL_ID`; `PARITY_ALERT_USER_ID` is optional.

| Runtime | Command | Use |
| --- | --- | --- |
| Installed JavaScript package | `parity-doctor [--send-test]` | Checks connection, guild access, audit permission, private alert channel, send permission, and optional owner visibility. |
| Repository, JavaScript | `npm run doctor -- [--send-test]` | Same doctor from this repository. |
| Installed Python package | `parity-doctor [--send-test]` | Same checks using the Python client. |
| Repository, Python | `cd parity-py` then `python -m parity_py.doctor [--send-test]` | Same doctor from source. |

`--send-test` posts one tracked Components V2 confirmation message. The doctor passes that check only when the message is received and reconciled without producing drift. Run it against a private alert channel before deployment.

## Quick sheet: a simple JavaScript bot

Add Parity when the Discord client is created. For the supported manager calls, this is the only additional tracking setting a simple bot needs:

```js
import { attach } from '@project-parity/js';

const parity = attach(client, {
  alertChannelId: process.env.PARITY_ALERT_CHANNEL_ID,
  alertUserId: process.env.PARITY_ALERT_USER_ID,
  autoWrap: true,
});
```

Then use this sequence from the bot's working directory:

```sh
parity init
parity settings console drift
parity-doctor --send-test
parity check
parity logs --drift --limit 20
```

`autoWrap: true` covers the documented role, channel, member, ban, emoji, sticker, invite, scheduled-event, AutoMod, permission-overwrite, and thread-create manager methods. Check coverage after startup:

```js
console.log(parity.getAutoWrapCoverage());
```

For a message send, a standalone webhook, or any API outside that map, track the operation explicitly:

```js
await parity.track(
  message => ({ actionType: 'MESSAGE_CREATE', targetId: String(message.id), targetType: 'message', guildId: String(message.guildId) }),
  () => channel.send('Hello from the bot'),
);
```

## Advanced repository checks

These commands are for maintainers testing a disposable guild. They require `DISCORD_BOT_TOKEN` and `PARITY_GUILD_ID`, create temporary resources, and remove those resources when complete.

| Command | Arguments | What it verifies | Example |
| --- | --- | --- | --- |
| `npm run live-test:chaos` | `PARITY_CHAOS_MUTATIONS` from 100 through 1,000 | At least 100 real tracked bot messages reconcile, then a real audit-log channel update reconciles after the burst. | `$env:PARITY_CHAOS_MUTATIONS = '100'; npm run live-test:chaos` |
| `npm run test:bot-matrix` | None | Runs each of the 100 copyable bot examples before and after its intended Parity integration. | `npm run test:bot-matrix` |
| `npm run live-test:bot-matrix` | None | Sends one baseline and one tracked output for each catalog bot in a disposable channel. | `npm run live-test:bot-matrix` |
| `npm run capture:audits --` | `--count`, `--timeout-ms`, `--output` | Captures anonymized audit payload shapes for review during a Discord or discord.js upgrade. | `npm run capture:audits -- --count 25 --output parity-spec/observed-fixtures/upgrade.json` |

See [Audit fixture capture](docs/audit-fixtures.md) before committing a capture. The tool replaces identifiers and timestamps and excludes raw change values.

## Quick sheet: a simple Python bot

Python uses explicit recording for outbound actions. Attach Parity once, then wrap Discord calls when a target ID is generated by Discord:

```py
from parity_py import attach

parity = await attach(
    client,
    alert_channel_id=os.environ['PARITY_ALERT_CHANNEL_ID'],
    alert_user_id=os.getenv('PARITY_ALERT_USER_ID'),
)

message = await parity['track'](
    lambda result: {
        'actionType': 'MESSAGE_CREATE',
        'targetId': str(result.id),
        'targetType': 'message',
        'guildId': str(channel.guild.id),
    },
    lambda: channel.send('Hello from the bot'),
)
```

For an action whose target ID is already known, record before the Discord call:

```py
await parity['intent']({
    'actionType': 'ROLE_UPDATE',
    'targetId': str(role.id),
    'targetType': 'role',
    'guildId': str(guild.id),
})
await role.edit(name='new-name')
```

Use the same command sequence as JavaScript after installing the Python package. From this repository without installing it, run the Python form shown above from `parity-py/`.

## What to check when something looks wrong

| Situation | First command | Next action |
| --- | --- | --- |
| Bot just deployed | `parity check` | If stale or missing, confirm `attach(...)` ran and that the CLI shares `PARITY_RUNTIME_DIR`. |
| No owner alert arrived | `parity-doctor --send-test` | Fix the failing connection, permission, privacy, or owner-visibility check. |
| An expected action reported drift | `parity logs --drift --json` | Inspect the event and use `track(...)` or `intent(...)` for an uncovered API. |
| PM2 output is too noisy | `parity settings console off` | Use `parity logs` when investigating instead. |
| Need brief live incident output | `parity settings console drift` | Keep normal lifecycle records on disk without printing all of them. |
| Testing from a second shell | `parity status` | Set the same absolute `PARITY_RUNTIME_DIR` as the bot process. |
