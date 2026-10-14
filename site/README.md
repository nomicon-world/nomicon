# Site

Viewers and pages that render World and ledger data. This directory is code, so it belongs to the Laws layer and changes by the Laws procedure.

The site is served by GitHub Pages straight from the `main` branch root, with no build step: `.nojekyll` at the root turns the Jekyll pass off, so files are published exactly as committed and nothing in the repository is ever interpreted. `index.html` at the root is the landing page. Each page fetches its data by relative path, so the same pages work from any static server pointed at the repository root.

- `replicator-map.html`: renders `world/replicator-map/`. Serve the repository root over HTTP and open `site/replicator-map.html`. It fetches the JSON files relative to itself, so opening it as a local file does not work.
- `map.html`: the World map, built from `ledger/map.json`. Points, links, spaces you can enter, open spots, question badges, and a panel per point or link with the questions it asks and the jobs that answer them. Links of the form `map.html#node=<id>&do=<option>` open a job card.
- `ways.html`: every way to take part, from `paths.json`, with job cards for options that need no place.
- `jobs.js`: builds job cards from `paths.json` and a place; `agent/src/jobs.ts` holds the same logic for the agent's `/job` endpoint, and a test keeps them identical. Pages import it with a version number (`jobs.js?v=N`); raise N whenever this file changes.
- `pay.html`: pay a quote with a browser wallet, so the key never leaves the wallet. Its payment code is `x402pay.js`, which `agent/test/x402pay.test.ts` checks against the x402 libraries.
- `leaderboard.html`: renders `ledger/state.json` and `ledger/questions.json`: weight by account, open and answered questions, open votes. Same serving rule.
