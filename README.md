# Project Parity

**Project Parity is a drift watchdog for Discord bots.** Bot tokens get leaked, reused, or run by unauthorized processes, and Discord does not tell the intended bot process when that happens.

Parity writes an intent before the host bot calls Discord, reconciles audit-log and self-message gateway events performed by the bot identity, and emits a portable JSON drift report when no matching intent exists.

## Quickstart

### JavaScript

```js
import { attach } from "@project-parity/js";
attach(client);
```

### Python

```py
from parity_py import attach
await attach(client)
```

Wrap actions with the returned `parity.intent(...)` helper (or call its ledger directly) before performing them. The client needs `VIEW_AUDIT_LOG` and audit-log gateway delivery enabled.

## License

Free to use, modify, embed, and sell products built with Parity; you may not resell Parity itself or a competing rebrand until the FSL change date. See [LICENSE.md](LICENSE.md).
