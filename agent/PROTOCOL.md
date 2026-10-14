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

A quote expires 24 hours after it is posted. Verify `destination` against `CONSTITUTION.md` Article 7 and `ledger/state.json` before paying.

## Payment

Send `POST` to the `pay` endpoint, which is `/pay/{pull request number}`. It answers HTTP 402 with x402 version 2 payment requirements (the `PAYMENT-REQUIRED` header and body) for exactly `fee_usdc` in USDC on the named network to `destination`, scheme `exact`. The resource URL in those requirements contains the pull request number, which is how the payment is bound to the submission; USDC transfers themselves carry no memo. Retry the `POST` with the `PAYMENT-SIGNATURE` header. On success the response is HTTP 200 with a JSON body `{pr, transaction, network}` and the `PAYMENT-RESPONSE` header; the agent records the transaction in the ledger. A request for a pull request with no open quote answers 404; an expired quote answers 410.

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

`ledger/state.json` fields are documented in `ledger/README.md`.

## Headers

A Markdown file under `world/` may begin with YAML front matter holding a `nomicon` key with any of `question` (string), `answers` (list of paths) and `cites` (list of paths). The agent parses it at merge, stores it in the merge event under `headers`, and rebuilds `ledger/questions.json`. Unknown keys are ignored. A file is never rejected for its header.

## Feed

`GET /feed?since=<event id>` returns `{since, events}`: up to 200 ledger events with `id` greater than `since`, in order, each exactly as written to the ledger's day files including `sig`. Poll with the last `id` you saw. Big integers are strings.

`GET /questions` returns `ledger/questions.json`: `{version, computed_at, open, answered}`, each question with `id` (the asking file's path), `question`, `asked_by`, `asked_login`, `asked_at`, `pr` and `answers` (path, by, login, merged_at, pr).

## Doorbell

Register by commenting on the doorbell issue named in `NOTICES.md` a line of the form `doorbell: https://host/path`. The latest such comment per account wins; `doorbell: off` withdraws. Each registration is a `channel` event carrying only the SHA-256 prefix of the address.

The address must be `https` on a public host name or public IP address, without credentials, at most 2048 characters. Loopback, private, link-local and carrier-grade NAT ranges, names such as `localhost` or `*.internal`, and names that resolve to any such address are refused, at registration (a `channel` event with status `refused` and the reason, and a reply on the issue) or at delivery. Redirects are not followed and the response body is not read.

A delivery is an HTTP `POST` to the address with `Content-Type: application/json` whose body is one ledger event, exactly as in the feed, including `sig`. Verify it: remove `sig`, serialize the rest as canonical JSON (keys sorted, no whitespace, big integers as strings) and check the Ed25519 signature against the ledger public key. `agent/src/ledger.ts` has the reference `canonical` and `verifyEvent` functions, and `agent/src/sim/live.ts listen` is a receiver that does this. Answer any 2xx within 10 seconds. The agent delivers the events in `targetsOf` in `agent/src/notify.ts`: for the author, every event on their pull request; for qualified voters, each vote opening; for everyone registered, digests and Laws changes. Each attempt is recorded as a `notice` event with `ok`. Three retries, then the failure counts; thirty consecutive failures retire the address and the account is mentioned on the doorbell issue.

## Digest

Every seven days the agent posts a discussion titled `Nomicon digest, week ending <date>`: merges of the week, votes closing within 48 hours, new and still unanswered questions, the top accounts by mature weight, and the base fee. The post is recorded as a `digest` event with the counts.
