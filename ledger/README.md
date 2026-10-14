# Ledger

The public record. Only the enforcement agent writes here. No pull request may touch this directory. Entries are signed with the key named in `CONSTITUTION.md` Article 11, and the ledger head hash is anchored on the fee network at each fee adjustment.

## events/

One file per UTC day, `events/YYYY-MM-DD.jsonl`, named by the day of each event's `at`. Each line is one JSON object, append-only, and ids run continuously across files: the first id in a day's file follows the last id of the day before. Every object has `id` (sequential integer), `at` (UTC seconds), `type`, `sig` (signature over the canonical JSON of the object without `sig`), and type-specific fields. Formal schema in `events.schema.json`. To read the whole ledger, read the files in name order. To follow it, read `head.json`, then the file it names from the line after the last id you have.

## public-key.pem

The key named in Constitution Article 11, which signs the ledger from genesis. Replay starts from it and follows `key_rotation` events; `state.json` carries the key in force now as `ledger_key` once a rotation has happened.

## head.json

`{ version, head_event, head_hash, segment, updated_at }`: the latest event's id, the SHA-256 over the hashes of every event in order, the day file holding it, and its time. Rewritten on every append.

Types:

| type | when | key fields |
|---|---|---|
| `genesis` | first event; bootstrap begins | `head`, `owner_accounts`, `owner_keys`, `agent_account`, `fee_destination`, `laws_hash` |
| `intake_reject` | failed Law 6 or Law 8 at intake, no fee | `pr`, `account`, `reasons` |
| `screen_hold` | screen held a submission | `pr`, `head`, `account`, `reason_class`, `screened_bytes` |
| `screen_deferred` | screening waits for a place under Law 10 | `pr`, `head`, `account`, `reason` (`account_count`, `account_bytes`, `global_bytes`, `newcomer_bytes`, `capacity`, `votes_owed`, `growth`) |
| `vote_queued` | paid, waiting for a place to open its vote (Law 2) | `pr`, `payment` (event id), `position`, `max_open` |
| `quote_lapsed` | quote expired unpaid | `pr` |
| `hold_resolved` | owner released or rejected a hold | `pr`, `decision`, `reason` |
| `quote` | fee quoted | `pr`, `head`, `layer`, `fee_micro`, `base_micro`, `multiplier`, `concurrency`, `size_kb`, `terms_commit`, `destination`, `expires`, `screening` (`model`, `reused`, `released`), `screened_bytes`, `bytes` (diff bytes, for Law 6), `queue_ahead`, `tax`, `tax_registration` |
| `payment` | payment verified | `pr`, `tx`, `block`, `block_time`, `amount_micro`, `from`, `cad_value`, `cad_rate` (USD/CAD used), `matched` |
| `vote_open` | window opened | `pr`, `head`, `opened`, `closes`, `laws_hash`, `qualified` (list of account ids), `authors`, `commits` (sha, author, verified) |
| `review` | a review by a qualified voter, recorded when the agent sees it during the window (Law 13) and complete at close | `pr`, `account`, `login`, `review_id`, `state`, `submitted` |
| `vote_close` | tally | `pr`, `yes_voters`, `yes_micro`, `no_micro`, `tie` (equal weight, no decision), `tally_result`, `result` (`merge`, `reject`, `expire`, `await_owner`) |
| `merge` | merged | `pr`, `head`, `merge_commit`, `weight_micro`, `account`, `paths`, `headers` (per path: question, answers, cites), `bytes` (files added or changed) |
| `withdrawal` | author pushed, closed or drafted after open | `pr`, `fee_disposition` |
| `expiry` | expired | `pr`, `held_until` (90 days, or 365 when the owner caused the expiry), `reason` |
| `merge_deferred` | passed, waiting for the World growth budget (Law 2.6) | `pr`, `reason` |
| `bar_lifted` | the owner lifted a 90-day bar after a response (Law 10) | `account`, `reason`, `by` |
| `owner_accounts_change` | an owner account named under Article 6, effective fourteen days later | `account`, `effective_at`, `reason`, `by` |
| `owner_confirm` / `owner_reject` | bootstrap decision | `pr`, `reason` |
| `fee_adjust` | base fee changed | `base_micro`, `submissions_24h`, `target`, `anchor_tx` |
| `takedown` | Article 5 | `paths`, `notice_hash`, `weight_revoked` |
| `redaction` | content removed from ledger | `event_id`, `hash` |
| `patch` / `deploy` | agent code | `commit`, `reason` |
| `destination_change` | Article 7 | `destination`, `by` |
| `key_rotation` | Article 11: the ledger signing key changes from the next event on | `new_public_key` (PEM), `commit` (owner's announcement on `main`), `reason`, `by`; after a lost key instead `tx` (the announcing transaction from the fee destination), `announced_at` (its block time), `announced_from`, `lost: true`, and the event is signed by the new key |
| `agent_account_change` | owner custody of the agent's platform identity (Article 6), e.g. moving to a GitHub App or to a successor operator | `agent_account`, `login`, `reason`, `by` |
| `declare` | bootstrap end, maintenance window, Terms amendment (Article 13) | `what`, `constitution_hashes`; for `terms_amendment`: `commit`, `previous_commit`, `provision`, `effective_at` |
| `correction` | replay found an error | `event_id`, `evidence` |
| `refusal` | agent refused a non-compliant laws.json | `laws_hash`, `reason` |
| `laws_snapshot` | a laws.json version and when it takes effect | `laws_hash`, `laws_raw`, `schema_raw`, `effective_at`, `merge_commit` |
| `owner_action_applied` | agent carried out an owner decision | `pr`, `event` |
| `channel` | an account chose how to be reached | `account`, `login`, `channel` (`doorbell`, `watch`), `status` (`active`, `retired`, `off`, `refused`), `url_hash`, `reason` |
| `notice` | the agent told someone something | `kind` (`mention`, `doorbell`), `target`, `pr`, `about` (event id), `ok` |
| `digest` | weekly digest posted | `url`, `merges`, `open_votes`, `open_questions`, `active_accounts`, `stars` |
| `world_direct` | World files on `main` that no merge recorded, such as files the owner committed during bootstrap (Article 3); each fingerprint is recorded once | `files` (each `path` and `sha`, the git blob hash), `note` |

## questions.json

Derived from merge events by the agent: every question asked in a merged file, who asked, when, and which merged files answered it. `open` and `answered` lists, oldest first. See `LAWS.md` Law 12.

## state.json

Recomputed from the event files by the replay tool.

| field | meaning |
|---|---|
| `computed_at` | UTC seconds |
| `head_event` | id of the last event folded in |
| `bootstrap` | `active`, `began`, `ends_by` |
| `fee` | `base_micro`, `destination`, `last_adjusted_at` |
| `weights` | map of account id to `{login, mature_micro, immature_micro, last_vote_at}` |
| `weighted_accounts` | count of accounts with mature weight above zero |
| `open_votes` | list of `{pr, closes, laws_hash}` |
| `held_fees`, `held_in_use` (held fees applied to submissions still undecided, by pull request) | list of `{account, layer, micro, until}` |
| `deployed_agent` | commit hash |
| `version` | format version of this file |
| `pending_owner_accounts` | owner accounts named and not yet in force, with `effective_at` (Article 6) |
| `ledger_key` | public key signing now after a rotation; null means the key in `ledger/public-key.pem` (Article 11) |
| `merges` | every merge: `pr`, `account`, `mergedAt`, `weightMicro`, and `revoked` after a takedown |
| `logins` | account id to the login last seen |
| `last_vote_at` | account id to the time of its last vote (Law 4 decay) |
| `owner_accounts`, `agent_account` | the accounts in force |
| `barred_until` | account id to the end of a bar (Law 10) |
| `pr_account` | pull request to the account that opened it |
| `path_author` | each merged path to the account that merged it; files the owner committed directly are not here but in `world_direct` events |
| `questions` | questions and answers as merges recorded them; `ledger/questions.json` adds what is on `main` (see `agent/PROTOCOL.md`) |
| `channels` | how each account chose to be reached (Law 12) |

Anyone can recompute `state.json` from the event files and the rules with the replay tool in `agent/`. If the recomputation differs from the published state, the published state is wrong.
