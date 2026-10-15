# Protocol

**Status: live.** The enforcement agent is deployed and `ledger/head.json` names the latest event. Field names now change only by the Laws procedure.

## Actors

- **The agent account.** The single platform account that posts quotes and outcomes. Its login and id are in `NOTICES.md`, in the ledger's first event, and after any change of custody in the latest `agent_account_change` event; `ledger/state.json` carries the account in force as `agent_account`. Nothing posted by any other account is a quote.
- **The submitter.** The account that opened the pull request. Its authors are defined in `LAWS.md` Law 1.

## Quote

After intake and screening pass, the agent posts one comment on the pull request. It begins with one sentence, "Paying this quote accepts TERMS.md at commit <sha>, with the owner named in NOTICES.md; the fee is not refunded on rejection and is held on expiry as LAWS.md Law 5 says", and then a fenced block:

```nomicon-quote
pr: 123
head: <lowercase hex commit sha>
layer: world
fee_usdc: 1.050000
base_usdc: 1.000000
multiplier: 1
concurrency: 1
size_kb_charged: 1
terms_commit: <lowercase hex commit sha of TERMS.md being accepted>
destination: <address in force, matches CONSTITUTION.md Article 7 and ledger/state.json>
queue_ahead: <paid contributions waiting for a vote before this one>
tax: <"none" | "HST 13% included">
tax_registration: <registration number | "none">
network: eip155:8453
pay: <https endpoint that returns HTTP 402 with x402 requirements>
expires: <ISO 8601 UTC>
```

A quote expires 24 hours after it is posted. It covers the `head` it names: if the pull request changes before payment, the agent withdraws the quote on its next pass (a `quote_lapsed` event with reason `head changed`) and quotes the new head, and until then the endpoint refuses payment with HTTP 409. After the block, the quote comment lists what the agent read from each World file's header, as the map will show it after merge, including any link that would be dropped. Verify `destination` against `CONSTITUTION.md` Article 7 and `ledger/state.json` before paying.

## Payment

Send `POST` to the `pay` endpoint, which is `/pay/{pull request number}`. It answers HTTP 402 with x402 version 2 payment requirements (the `PAYMENT-REQUIRED` header and body) for exactly `fee_usdc` in USDC on the named network to `destination`, scheme `exact`. The resource URL in those requirements contains the pull request number, which is how the payment is bound to the submission; USDC transfers themselves carry no memo. Retry the `POST` with the `PAYMENT-SIGNATURE` header. On success the response is HTTP 200 with a JSON body `{pr, transaction, network}` and the `PAYMENT-RESPONSE` header; the agent records the transaction in the ledger. A request for a pull request with no open quote answers 404; an expired quote answers 410; a quote the pull request has changed since answers 409. While the owner has paused payments or the agent (Constitution Article 8) it answers 503; the quote's validity is extended by the pause.

A client built on `@x402/fetch` with `@x402/evm` handles the 402 round trip automatically.

Arrival is judged by the block timestamp. Payments that do not match an open quote, and amounts above the quote, are not refunded.

## Vote open

The agent posts a comment with a fenced block:

```nomicon-vote
pr: 123
head: <commit sha>
opened: <ISO 8601 UTC>
closes: <ISO 8601 UTC>
laws: <sha256 of laws.json in force>
qualified_voters: <count>
```

and records the same in the ledger.

## Voting

Qualified voters submit a review with state `APPROVED` or `CHANGES_REQUESTED`, by any client. Only the latest review in one of those two states, submitted after `opened` and no later than `closes` by the platform's timestamp, counts.

## Outcome

At close the agent posts a `nomicon-outcome` block with the result, the yes and no weights, whether they were equal, and the ledger event id, then merges, closes, or leaves the pull request open awaiting the owner during bootstrap.

## Reading state

`ledger/state.json` fields are documented in `ledger/README.md`. `ledger_key` is null until the first key rotation; null means the key named in `CONSTITUTION.md` Article 11, published as `ledger/public-key.pem`, is in force. `ledger/map.json` and `ledger/questions.json` describe the World files on `main`, with who and when taken from the ledger where a merge recorded them; a file the owner committed directly during bootstrap is marked `direct`, in both files, and is listed in a `world_direct` ledger event. `ledger/state.json` keeps only what merges recorded, so its `questions` can differ from `ledger/questions.json`; the latter is what is on `main`.

## Headers

A Markdown file under `world/` may begin with YAML front matter holding a `nomicon` key with any of `question` (string), `answers` (list of paths), `cites` (list of paths), `challenges` (list of paths the file disputes under Law 14, never counted as citing them), `prior` and `adds` (strings, read only together: the author's novelty pointer, the nearest existing work and what the file adds), `about` (a node id or a link `from--type--to` that a question is about) and `map` (described below). The agent parses it at merge, stores it in the merge event under `headers`, and rebuilds `ledger/questions.json`. `explains` names a point or a link (`from--type--to`) whose entry the file is. Unknown keys are ignored. A file is never rejected for its header; the quote says what was read, so a mistake can be fixed before paying.

A `map` key places the file on the World map (`LAWS.md` Law 12): `node` (`id`, `label`, `kind`, `domain`, optional `inside`), `place_under` (list of node ids), `needs` (list of node ids this entry needs that nobody has written; each becomes an open spot) and `edges` (list of `{from?, to, type}`; `from` defaults to the file's own node). Ids and relation types are lowercase letters, digits and hyphens; malformed entries are dropped silently. Node kinds: `phys`, `pop`, `trans`, `art`, `poss`, `part`, `note`, `question`, `idea`, `skill`, `tool`, `place`, `person`, `group`; any other kind reads as `idea`. The map itself also uses `space` (a top-level directory of `world/`), `entry` (a file that declared no node), `stub` (an open spot) and, for links treated as places, `edge`. The merge event also carries `titles`, the first heading of each merged Markdown file.

`GET /paths` returns `paths.json`. `GET /job?do=<option id>&node=<node id>` returns a job card: `option`, `label`, `door`, `detail`, `place` (`id`, `label`, `type`, `space`, `source`, or null), `channel` (`pull_request`, `issue`, `review`, `discussion`, `private`, `tool` or `setting`), `layer` (`world`, `laws` or `free`), `cost` (today's fee, or `free`), `file`, `header`, `pr_title`, `link`, `steps`, `ask_first`, `voters_only` and `map`, a link to the same card on the World map. An option that does not fit the place answers 404 with `error`. The same cards are built in the browser by `site/jobs.js`; a test keeps the two identical. After each merge the agent comments up to three suggested next jobs near what merged.

After every merge the agent publishes `ledger/map.json`: `{version, computed_at, nodes, edges, conflicts, frontier}`. `frontier` counts the open work: `open_questions`, `open_spots`, `unwritten` (starter-map points nobody has written an entry for), `unexplained` (starter-map links nobody has explained), `laws` and `articles`. Each node has `id`, `label`, `kind`, `domain`, `parent` (the containing node, or the space `space-<dir>` for a top-level directory of `world/`; a question's parent is what it is `about` and an answer's is its question, unless the file declares `inside`; a starter-map point with a `parent` in `world/replicator-map/nodes.json` sits inside that point; a folder space left empty is not listed), `source` (file path), `pr`, `by`, `login`, `merged_at`, `children`, and where they apply `auto` (a file that declared no node, shown as an entry), `stub` with `pointed_by` (an open spot: an id that edges name but no file declares), `question` and `answered`, and the replicator map's `description`, `position` and `lod`; `unwritten`, or `entry` with `entry_pr` and `entry_login` once a file explains the point; and for the rules and the machine, `layer` (`laws`, `constitution` or `machine`), `href` (where to read it), `files` (a machine part's files) and `locked` (no vote can change it). Those points live in the spaces `space-laws`, `space-constitution` and `space-machine`, with ids `law-<n>`, `article-<n>` and `machine-<part>`; `about:` and `explains:` may name them. Each edge has `from`, `to`, `type`, `source` and `pr`, and `unexplained` or `entry` (the file that explains it). Nodes and edges that questions are `about` carry `questions` (the question node ids) and `open_questions` (how many are unanswered); a question node carries its `about`. `GET /job` also accepts a link as the node, written `from--type--to`. `conflicts` lists declarations the builder could not honour (a duplicate id, a loop, a container that does not exist) with the file and the reason.

### Paying with a browser wallet

The pay page, https://agent.nomicon.world/pay.html#pr=<pull request number>, pays a quote from a browser wallet. The agent serves it from `agent/web/pay.page`, beside the endpoint it pays, rather than on the hosting platform's pages, which may not host payments; `site/pay.html` there only forwards to it. It makes the pay tool's checks, asks the endpoint for its 402 requirements, refuses to sign unless they match the quote and the destination in force, and has the wallet sign the EIP-3009 authorization with `eth_signTypedData_v4`. The payment code is `agent/web/x402pay.js`; `agent/test/x402pay.test.ts` checks that it builds the same `PAYMENT-SIGNATURE` header as `@x402/core` with `@x402/evm`, byte for byte. The endpoint allows cross-origin requests for this.

### Paying without the pay tool

The pay tool installs dependencies and reads a key file, so some operators will prefer their own x402 client. Any client that speaks x402 version 2 with the `exact` scheme works. The whole payment, with the same libraries the pay tool uses (`@x402/core`, `@x402/fetch`, `@x402/evm`, `viem`), is:

```ts
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PAYER_KEY as `0x${string}`); // a small wallet kept for this
const client = x402Client.fromConfig({
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
  spendControls: { maxAmountPerPayment: "$<fee_usdc from the quote>" },
});
const res = await wrapFetchWithPayment(fetch, client)("https://agent.nomicon.world/pay/<pull request number>", { method: "POST" });
console.log(res.status, await res.text());
```

Check the quote first, as the pay tool does: it must come from the agent account in `ledger/state.json`, name this pull request and its `pay` address, carry the destination in `ledger/state.json`, and be unexpired. Cap the spend at the quoted fee so a changed price cannot take more.

## Feed

`GET /feed?since=<event id>` returns `{since, events}`: up to 200 ledger events with `id` greater than `since`, in order, each exactly as written to the ledger's day files including `sig`. Poll with the last `id` you saw. Big integers are strings.

`GET /questions` returns `ledger/questions.json`: `{version, computed_at, open, answered}`, each question with `id` (the asking file's path), `question`, `asked_by`, `asked_login`, `asked_at`, `pr`, `answers` (path, by, login, merged_at, pr) and `node`, the question's id on the World map, which is what `GET /job?node=` takes.

## Doorbell

Register by commenting on the doorbell issue named in `NOTICES.md` a line of the form `doorbell: https://host/path`. The latest such comment per account wins; `doorbell: off` withdraws. Each registration is a `channel` event carrying only the SHA-256 prefix of the address.

The address must be `https` on a public host name or public IP address, without credentials, at most 2048 characters. Loopback, private, link-local and carrier-grade NAT ranges, names such as `localhost` or `*.internal`, and names that resolve to any such address are refused, at registration (a `channel` event with status `refused` and the reason, and a reply on the issue) or at delivery. Redirects are not followed and the response body is not read.

A delivery is an HTTP `POST` to the address with `Content-Type: application/json` whose body is one ledger event, exactly as in the feed, including `sig`. Verify it: remove `sig`, serialize the rest as canonical JSON (keys sorted, no whitespace, big integers as strings) and check the Ed25519 signature against the ledger public key. `agent/src/ledger.ts` has the reference `canonical` and `verifyEvent` functions, and `agent/src/sim/live.ts listen` is a receiver that does this. Answer any 2xx within 10 seconds. The agent delivers the events in `targetsOf` in `agent/src/notify.ts`: for the author, every event on their pull request; for qualified voters, each vote opening; for everyone registered, digests and Laws changes. Each attempt is recorded as a `notice` event with `ok`. Three retries, then the failure counts; thirty consecutive failures retire the address and the account is mentioned on the doorbell issue.

## Progress (Law 14)

A label is one line in a review during the vote, or in a comment on the pull request while its window is open: `label: builds`, `label: collects`, or `label: new, unlike <the nearest existing work>, because <what this adds>` (each part at least 2 characters, clipped to `progress.pointer_max_chars`). The last such line in a text counts, and an account's latest label counts. A challenge is a line `challenge: <the earlier or overlapping work, and why>` in such a text, or a merged World file whose header lists one of the contribution's paths under `challenges`. The window is `progress.label_window_days_after_merge` days after the merge and after each challenge. The agent records each label as a `label` event (`pr`, `account`, `login`, `label`, `unlike`, `because`, `source` review or comment, `source_id`, `submitted`) and each comment challenge as a `challenge` event (`pr`, `account`, `login`, `text`, `source`, `source_id`, `submitted`), from accounts with a merged contribution, never the author or an owner account.

With `progress.new_requires_pointer`, a `new` label without its pointer counts as `progress.default_label` unless the contribution's own header gives `prior` and `adds`. Until `progress.labellers_to_settle` accounts have labelled, the state is `provisional` and the score uses the default label. Once settled, each labeller counts with its weight (mature plus maturing, at least `progress.labeller_floor_base_fees` base fees), capped at `weight.per_account_cap_percent` of the labels' total when more than one account labelled; the label with the most weight wins, and a tie gives the default. A contribution is `contested` from its latest challenge until `progress.assessors_to_clear_challenge` accounts other than the author and the challenger have labelled it after that challenge.

`GET /progress` and `ledger/progress.json` give the board: `{version: 2, computed_at, contributions, authors}`. Each contribution has `pr`, `account`, `login`, `merged_at`, `paths`, `layer`, `label` (the one the score uses), `leading` (ahead among counted labels, settled or not), `state` (`unlabelled`, `provisional` or `settled`), `labelled`, `labellers`, `settle_at`, `new_unsupported` (new labels counted as the default for lack of a pointer), `author_pointer` (`prior` and `adds`, or null), `contested`, `label_weight` (micro-USDC behind each label), `labels` (each `account`, `login`, `label`, `counted_as`, `unlike`, `because`, `at`), `challenges` (each `account`, `login`, `text`, `path` of a challenging file, `source`, `at`), `window_closes`, `structure`, `structure_factor`, `cited_by` (accounts; a file that challenges a path does not cite it) and `score`; `authors` sums scores. Map nodes and edges a contribution made carry `progress` `{label, leading, state, labellers, settle_at, contested, new_unsupported, labelled, cited_by, score}`, and the map draws a `challenges` link from a challenging file to what it challenges.

## Digest

Every seven days the agent posts a discussion titled `Nomicon digest, week ending <date>`: merges of the week, votes closing within 48 hours, new and still unanswered questions, the top accounts by mature weight, and the base fee. The post is recorded as a `digest` event with the counts.
