# Project Parity for Python

Project Parity is a drift watchdog for Discord bots using Python Discord clients. It records expected actions, compares them with Discord audit-log and self-message events, and alerts on unplanned actions performed by the bot identity.

```sh
pip install project-parity[discord]
```

```py
from parity_py import attach

parity = await attach(
    client,
    alert_channel_id=os.environ['PARITY_ALERT_CHANNEL_ID'],
)
```

See the [repository documentation](https://github.com/XxVoidicxX/project-parity) for setup, commands, and coverage limits.
