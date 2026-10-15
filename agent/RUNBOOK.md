# Runbook

How the enforcement agent is run, kept alive, backed up and handed over. This file is for whoever operates the agent; the Constitution's continuity article assumes it exists and is accurate.

## What runs where

One small server runs two processes: the agent (Node, `node dist/cli.js run`) and Caddy, which terminates TLS at the public address and forwards to the agent. Everything the agent needs on disk lives under `/srv/nomicon`:

| path | holds | backed up |
|---|---|---|
| `/srv/nomicon/repo` | a clone of the repository; the agent writes `ledger/events/` and `ledger/head.json` here and publishes them to GitHub every tick | yes |
| `/srv/nomicon/private` | `doorbells.json`, the registered doorbell addresses and the delivery cursor | yes |
| `/srv/nomicon/secrets` | `ledger.pem` (ledger signing key), `github-app.pem` (App key), `agent.env` (all other secrets), mode 600, owned by uid 1000, the user the agent container runs as | yes, encrypted, off the box |

The public GitHub copy of `ledger/` is the source of truth for the ledger. The server copy is a working copy. Doorbell addresses and the two keys exist nowhere else, which is why they are backed up.

## First install

1. **Server.** A 2 vCPU, 4 GB Linux VPS with a static address is enough for years. Prefer a Canadian region (for example OVH Beauharnois) so the privacy notice can say the data stays in Canada. Ubuntu LTS, unattended security updates on, SSH keys only, firewall allowing 22, 80, 443.
2. **Clock.** Ledger timestamps come from this machine. Keep `systemd-timesyncd` or `chrony` active.
3. **DNS.** An A record for the agent's name (for example `agent.<domain>`) to the server. Caddy obtains the certificate itself once the record resolves.
4. **Docker.** Install Docker Engine with the compose plugin.
5. **Layout.** `mkdir -p /srv/nomicon/{repo,private,secrets}`; `chmod 700 /srv/nomicon/secrets`.
6. **Code.** `git clone https://github.com/nomicon-world/nomicon /srv/nomicon/repo`. The compose file builds the agent image from `/srv/nomicon/repo/agent`.
7. **Keys.** `cd /srv/nomicon/repo/agent && docker compose -f deploy/docker-compose.yml run --rm --no-deps agent node dist/cli.js keygen` prints a private and a public key. Save the private key as `/srv/nomicon/secrets/ledger.pem`; the public key goes into `CONSTITUTION.md` Article 11 and `ledger/public-key.pem`. Put the GitHub App key at `/srv/nomicon/secrets/github-app.pem` (see `GITHUB-APP.md`).
8. **Environment.** Copy `deploy/agent.env.example` to `/srv/nomicon/secrets/agent.env` and fill it. `NOMICON_DOMAIN=<the DNS name>` goes in `/srv/nomicon/repo/agent/deploy/.env` for Caddy.
9. **Genesis.** With the Constitution placeholders filled and committed: `docker compose -f deploy/docker-compose.yml run --rm --no-deps agent node dist/cli.js genesis <head commit sha>`. This writes the first two ledger events. There is no second genesis.
10. **Start.** `docker compose -f deploy/docker-compose.yml up -d --build`. Within a minute `https://<name>/` answers with the endpoint list and the log shows `github identity: nomicon-agent[bot] (...)` and `laws ... in force`.

## Day to day

- **Logs:** `docker compose -f deploy/docker-compose.yml logs -f agent`. Every tick that fails logs `tick failed:` with the reason; one failure is noise, a run of them is an outage. Both containers log to journald, which must keep logs no longer than the 30 days `PRIVACY.md` states: put `[Journal]`, `Storage=persistent` and `MaxRetentionSec=30day` in `/etc/systemd/journald.conf.d/00-nomicon.conf` and restart `systemd-journald`.
- **Health:** `GET /` on the public address returns JSON. The digest appears every seven days; its absence means the agent has been down or the App lost the Discussions permission.
- **Owner commands** are listed in their own section below, with arguments.
- **Verifying:** `docker compose ... exec agent node dist/cli.js replay` recomputes everything from the ledger and checks every signature. Run it after any manual intervention.

## Owner commands

Every command runs on the server with the agent's environment. With Docker: `docker compose -f deploy/docker-compose.yml exec agent node dist/cli.js <command>`; the examples below drop that prefix. Each appends one signed event to the ledger under a lock, prints `recorded event N: <type>`, and the running agent acts on it within one tick. If the lock is held, the command waits up to ten seconds, then fails and can be rerun. Pull requests are referred to by number.

| Command | What it records |
|---|---|
| `pending` | Nothing. Lists what waits on the owner: screening holds and their deadlines, closed votes awaiting confirmation, paid contributions in the queue, and continuity clocks. |
| `confirm <pr> "<reason>"` / `reject <pr> "<reason>" [--bar]` | A bootstrap decision on a closed vote (Article 3). `reject` holds the fee; with `--bar`, bars the account 90 days. |
| `release <pr> "<reason>"` / `hold-reject <pr> <ground> "<reason>"` | Resolves a screening hold; the ground is one of the Article 4 grounds, and the reason names no person. `hold-reject` bars the account 90 days. |
| `correct <event id> "<evidence>"` | Article 8: records a `correction` event saying what an earlier event got wrong and how we know. The earlier event stays, as the ledger is permanent. |
| `lift-bar <account id> "<reason>"` | Lifts a bar after the account responded (Law 10). |
| `takedown <pr,pr> <ground> <sha256 of the notice>` | Article 5: revokes the weight of the listed merges and records the notice's hash. See the procedure below. |
| `rotate-destination <address> "<reason>"` | Article 7: the fee destination from now on. |
| `set-agent-account "<reason>"` | Article 6: the agent now acts as the GitHub identity its credentials resolve to. |
| `name-owner <account id> "<reason>"` | Article 6: adds an owner account, effective fourteen days later. |
| `amend-terms <commit> "<provision>"` | Article 13, after bootstrap only: records a legally required change to `TERMS.md`, citing the statute, regulation or decision; effective thirty days later, for new quotes only. Commit the new text to `main` first and pass its full hash. |
| `rotate-key <new-public.pem> <commit> "<reason>"` / `rotate-key-lost <new-private.pem> <tx hash> "<reason>"` | Article 11. See Rotating the ledger key. |
| `maintenance <from_iso> <to_iso> "<reason>"` | Article 14: declares a maintenance window in advance, at most thirty days. Windows and pauses together may not pass ninety days in twelve months. |
| `pause <all\|quotes\|payments\|votes\|merges> "<ground>"` / `resume "<reason>"` | Article 8: stops the agent or one function. Every deadline that runs against a contributor waits: quotes, vote windows, holds, owner deadlines, held fees. At most thirty days a pause; `pending` warns. Use it whenever something frightens you; it is visible, temporary and allowed. |
| `outage <from_iso> <to_iso> "<what was down>"` | Law 5: records a past outage, which extends the quotes and deadlines it covered. |
| `veto <pr> "<ground; the provision or term quoted; the behaviour withheld>"` / `veto-review <veto event id> remains\|lifted "<why>"` | Article 8: declines to deploy part of a voted change, then reviews it every ninety days. Commit a revert of the withheld part to `main` before the change is fourteen days old, so the site never serves it. |
| `power <security\|adapt\|refuse\|measure\|retire\|transfer\|sealed> "<record>"` | Articles 6, 6A, 8, 11: records a power used, with what the Constitution asks the record to say. `sealed` is for a record the law forbids disclosing: the date, the power, the kind of requirement and the content hash only. |
| `refund <pr> <refund tx> "<the law, order, judgment or settlement>"` | Article 7: records a refund the law requires; revokes the weight its fee minted. Send the USDC yourself first. |
| `deploy <commit> "<reason>"` / `patch <commit> "<reason>"` / `amend-laws "<reason>"` / `end-bootstrap "<reason>"` | Article 8 and Article 3 records. |
| `record-payment <pr> <tx hash>` | A payment the facilitator settled but the agent failed to record (the log line begins `PAYMENT SETTLED BUT NOT RECORDED`). Verifies the transfer on chain first. |
| `check` / `replay` / `migrate-ledger` | Read-only checks, except `migrate-ledger`, which converts an old single-file ledger. Both may run beside the live agent. |

How a decision reaches you: every hold, closed vote and queued payment is a ledger event delivered to your own doorbell if you register one on the doorbell issue, and `pending` lists them with their deadlines. Register a doorbell for the owner account before launch.

## Takedown procedure (Article 5)

1. Record the notice: save it, compute its SHA-256, and keep the file with the backups.
2. Remove the content: from an owner account, commit the removal to `main` yourself; the agent never deletes content.
3. `takedown <pr,...> <ground> <hash>`: revokes the weight the merges minted and records the hash.
4. Tell the author on the pull request, with the ground and the response route.
5. A history rewrite is only for content whose presence in history is itself unlawful; it changes no ledger event, since events cite commits by hash and a rewritten commit simply no longer resolves.

## Outages

The agent is designed to be stopped. Quotes carry their expiry, votes carry their close time, and the agent catches up on everything when it returns; Law 5 extends quote validity by recorded outages. A payment made while the agent is down is matched when it comes back. Nothing needs to happen quickly except two things: the facilitator settling a payment (the payer retries) and a hold the owner must resolve within 14 days.

With the agent down nothing can be paid at all, since payment is a round trip through its endpoint; quotes keep their expiry and are renewed when it returns. If the facilitator is down, or the Coinbase key is invalid or out of its free tier, payers get an error from the endpoint and nothing is recorded; the agent log shows the facilitator's answer. If GitHub is down, ticks fail and resume. The Base RPC is used for anchoring, for recording a payment's block, and for `record-payment`; with it down, anchors are skipped and recorded as missed, payments record without a block, and everything else proceeds.

## Upgrading the agent

Code under `agent/` is Laws-layer. A change reaches the server only after it merged by the Laws procedure (or, during bootstrap, an owner amendment) and the fourteen days Constitution Article 8 requires have passed, with replay clean on the new commit, then: stop the agent (`docker compose ... stop agent`), `git -C /srv/nomicon/repo pull`, `docker compose ... up -d --build`, and once it is running `deploy <commit> "<reason>"` to record the deployment. The agent writes only under `ledger/`, which `git pull` never touches, so stopping it first is caution, not necessity. Run the simulation on a machine with Node before pulling, not on the server. An owner `patch` under Article 8, which may only make the code match the written rules, follows the same steps and records a `patch` event instead. Before either, run the simulation on the new commit: `npm run sim`.

## Backups

Nightly, to a different machine or an encrypted bucket: `/srv/nomicon/private` and `/srv/nomicon/secrets` (encrypted with a key held by the owner), plus `deploy/.env` and Caddy's data volume. The ledger itself needs no backup beyond GitHub, which holds every published event. Test a restore once: a fresh server, clone the repository, restore `private` and `secrets`, `check`, `replay`, start. A restored `doorbells.json` has an older delivery cursor, so the agent re-delivers the events since then; receivers ignore duplicates by event id. If it is lost entirely, the agent rebuilds registrations from the doorbell issue on its first tick and delivers from the next event on.

**Rotating the ledger key** (Article 11). Planned: stop the agent; generate a new pair with `keygen`; commit the new public key to `main` from an owner account with a message that announces it; run `rotate-key <new-public.pem> <that commit> "<reason>"` with the old key still configured; set `NOMICON_LEDGER_KEY` to the new private key (in `agent.env`, or the mounted file the compose file names) and start the agent. Stopping first matters: a running agent stops itself at its next append once the ledger names another key. Lost: from the fee destination wallet send a transaction on Base carrying the SHA-256 of the new public key as its data (`keygen` prints the hash); wait fourteen days after its block; then `rotate-key-lost <new-private.pem> <tx hash> "<reason>"`, which checks the transaction and signs the rotation with the new key. Keep two encrypted copies of the key in two places anyway; fourteen days of silence is the cost of losing it. Loss of `github-app.pem` means generating a new key on the App's page; loss of `doorbells.json` means every doorbell goes silent until accounts re-register, which the next digest should tell them.

## Handing over

Continuity under Constitution Article 14 means a successor operator can run the agent from this file, the repository, and the backups, with nothing that lived only in the previous operator's head. What changes hands: the domain, the server, the backup decryption key, the private store, the Coinbase and Anthropic accounts or their replacements, the fee destination wallet or a new one recorded with `rotate-destination`, and the ledger signing key or a rotation to the successor's own. A successor runs under their own GitHub App: they install it, configure its credentials, and record the change with `nomicon set-agent-account "<reason>"` before the first start, since the agent refuses to run as any identity other than the one the ledger names. Keep this file true.

## Going to mainnet

Everything above is network-neutral; these are the differences between the test network and Base mainnet, and `nomicon check` verifies each of them against the live services without moving money.

1. **Facilitator.** The public `x402.org` facilitator settles test networks only. Base mainnet settles through Coinbase's facilitator: create a CDP account and an API key at the Coinbase Developer Platform portal, put the id and secret in `agent.env` as `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`, and remove `X402_FACILITATOR_URL`. The first 1,000 settlements a month are free, then $0.001 each. Verification is free. The agent refuses to start on mainnet with a testnet-only facilitator.
2. **RPC.** `https://mainnet.base.org` works but is rate-limited and shared. A free-tier endpoint from a provider is steadier.
3. **Destination.** `NOMICON_FEE_DESTINATION` is the wallet in Constitution Article 7, custodied by the corporation. Any address that can receive a plain USDC transfer works; a hardware wallet is fine, since the agent never spends from it. Enter it in `CONSTITUTION.md` before genesis; after genesis it changes only through `rotate-destination`.
4. **Anchoring.** Article 11 anchors the ledger head on Base at every fee adjustment, four times a day. `ANCHOR_PRIVATE_KEY` is a separate, low-value wallet holding a little ETH on Base for gas, roughly a cent a day. It is required on mainnet; `check` fails without it or with an empty balance.
5. **Exchange rate.** Law 5 records the Canadian-dollar value of each payment. Unset `NOMICON_USDC_CAD` and the agent uses the Bank of Canada's daily USD/CAD average, cached twelve hours, falling back to a fixed rate if the feed is down. The rate used is written into each payment event.
6. **Addresses and switches.** The public URL must be `https`, and `NOMICON_DOORBELL_ALLOW_PRIVATE` must be unset; `check` fails on either.
7. **Run `nomicon check`** before genesis and after every configuration change. It prints one line per check and exits non-zero on any failure.
