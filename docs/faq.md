# FAQ

## Does Parity moderate users?

No. It watches only actions executed by the bot's own Discord identity.

## Can it see normal messages?

Discord does not audit-log them. Parity checks self-authored guild `MESSAGE_CREATE` events when callers ledger those sends.
