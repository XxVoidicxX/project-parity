# Observed audit fixtures

This directory is for reviewed, sanitized audit-shape captures created with `tools/capture-audit-fixtures.mjs`. Captures contain no Discord token, raw snowflake, message text, channel name, or audit timestamp.

Promote only deterministic representative cases into `parity-spec/fixtures/`, where the JavaScript and Python fixture drivers validate them together.
