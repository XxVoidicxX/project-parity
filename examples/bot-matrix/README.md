# Bot matrix examples

This catalog contains 100 copyable integration starting points: 50 JavaScript and 50 Python. Each combines one of ten meaningful Discord bot families with one of five deployment shapes.

Every example exports or defines a baseline bot without Parity, a Parity-enabled bot, and a single action boundary. JavaScript auto-wrap variants use `autoWrap: true`; Python variants record target-known actions explicitly; message responders use result-derived tracking in both runtimes.

Run `node tools/generate-bot-matrix.mjs` after changing the catalog generator. Run `npm run test:bot-matrix` to execute every baseline and Parity action boundary.
