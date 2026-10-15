# Site

Viewers and pages that render World and ledger data. This directory is code, so it belongs to the Laws layer and changes by the Laws procedure.

The site is served by GitHub Pages from the `live` branch root, with no build step: `.nojekyll` at the root turns the Jekyll pass off, so files are published exactly as committed and nothing in the repository is ever interpreted. The enforcement agent moves `live` to `main`'s head, except that a voted change to the served files (`agent/`, `laws.json`, `site/`, `index.html`) waits fourteen days after it merges (Constitution Article 8); meanwhile `live` stays at the commit before it. `index.html` at the root is the landing page. Pages read the ledger, `paths.json` and the World from `main` on raw.githubusercontent.com, so they show current data whatever `live` serves, and they work from any static server.

- `replicator-map.html`: renders `world/replicator-map/`. Serve the repository root over HTTP and open `site/replicator-map.html`. It fetches the JSON files relative to itself, so opening it as a local file does not work.
- `map.html`: the World map, built from `ledger/map.json`. Points, links, spaces you can enter, open spots, question badges, and a panel per point or link with the questions it asks and the jobs that answer them. Links of the form `map.html#node=<id>&do=<option>` open a job card.
- `ways.html`: every way to take part, from `paths.json`, with job cards for options that need no place.
- `jobs.js`: builds job cards from `paths.json` and a place; `agent/src/jobs.ts` holds the same logic for the agent's `/job` endpoint, and a test keeps them identical. Pages import it with a version number (`jobs.js?v=N`); raise N whenever this file changes.
- `pay.html`: forwards to the pay page on Nomicon's own server, https://agent.nomicon.world/pay.html. GitHub Pages may not host payments, so the page itself lives in `agent/web/pay.page` and the agent serves it; its payment code is `agent/web/x402pay.js`, which `agent/test/x402pay.test.ts` checks against the x402 libraries.
- `leaderboard.html`: renders `ledger/progress.json` (the Law 14 progress board), `ledger/state.json` and `ledger/questions.json`: progress, weight by account, open and answered questions, open votes. Same serving rule.
