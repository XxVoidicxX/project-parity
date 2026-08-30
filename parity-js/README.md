# @project-parity/js

Project Parity is a drift watchdog for Discord bots using discord.js. It records expected actions, compares them with Discord audit-log and self-message events, and alerts on unplanned actions performed by the bot identity.

```sh
npm install @project-parity/js discord.js
```

```js
import { attach } from '@project-parity/js';

const parity = attach(client, {
  alertChannelId: process.env.PARITY_ALERT_CHANNEL_ID,
  autoWrap: true,
});
```

See the [repository documentation](https://github.com/XxVoidicxX/project-parity) for setup, commands, supported automatic tracking, and coverage limits.
