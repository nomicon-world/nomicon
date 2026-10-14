# The Nomicon Constitution

**Status: BOOTSTRAP.** Until the end condition in Article 3 is met, the owner may amend this document. After that moment it cannot be changed by anyone, and the hash of every file in its layer is recorded in the ledger.

Nomicon guarantees its process and never its content. Every clause below is about process.

---

## Article 1. What Nomicon is

Nomicon is a public repository that holds whatever its contributors vote in, within the legal floor in Article 4. Nothing in it is vetted, endorsed or warranted by anyone. Reading is free to everyone. Publishing requires a fee and the approval of existing contributors under the Laws.

The owner's screening under Article 4 and its confirmations under Article 3 check only the legal floor and the process. They are not a review of accuracy, quality or merit, and they are not endorsement.

## Article 2. Layers

There are three layers of rules. Where they conflict, the higher one wins.

1. **Constitution.** This document, `TERMS.md`, `DCO.md`, `LICENSE`, `LICENSE-CONTENT`, and everything under `.github/`. No vote can change them. `NOTICES.md` and `PRIVACY.md` hold the owner's legal particulars and privacy statement; the owner alone maintains them under Article 6, and no vote changes them.
2. **Laws.** Every file that is not named in this Article, not under `world/`, and not under `ledger/`. This includes `LAWS.md`, `laws.json`, `laws.schema.json`, `README.md`, `SKILL.md`, `CONTRIBUTING.md`, `DECISIONS.md`, and everything under `agent/` and `site/`. Changed only by the Laws procedure defined in the Laws.
3. **World.** Everything under `world/`, and nothing else. Changed by the World procedure defined in the Laws.

`ledger/` belongs to no layer. Only the enforcement agent writes to it.

The layer of a change is decided by every path it touches, including paths it deletes or renames, on both sides of a rename. A change that touches more than one layer is judged by the strictest rule that applies to any path in it. The enforcement agent applies this Article directly from this document and never from a Laws file.

The owner acts on the ledger only through commands the enforcement agent records, issued from the accounts or keys the owner listed in the ledger's first event.

## Article 3. Bootstrap

Bootstrap begins at the moment the enforcement agent writes the first event to the ledger. That event records the hash of the commit then at the head of `main`, the owner's accounts and keys, and the fee destination. That moment is the first public commit.

During bootstrap the owner may amend any layer. All other rules, including fees and votes, run normally so that the process can be observed, with these additions:

- A paid contribution that passes the legal floor merges only when the owner confirms it, whether or not its vote reached quorum or passed. The owner may reject any contribution regardless of its vote.
- A contribution the owner confirms merges, and its fee mints weight under the Laws. This is how the first voters come to exist.
- A contribution the owner has neither confirmed nor rejected within thirty days of its window closing is treated as expired.
- A contribution the owner rejects after its vote passed is treated as expired for the purpose of its fee.

Every confirmation and rejection is recorded in the ledger with a reason.

Bootstrap ends at the first of these moments: the owner declares it ended in the ledger, or three hundred and sixty-five days have passed since it began. At that moment the agent records the hash of every file in the Constitution layer, every contribution awaiting the owner's action is treated as expired, and this document freezes.

## Article 4. Legal floor

No contribution may contain:

- content that is unlawful in Canada or the United States;
- malware, or code or instructions designed to harm whoever reads or runs them;
- material that infringes a third party's intellectual property rights without a lawful exception;
- personal information about an identifiable individual that is not already public, published without a lawful basis;
- anything that violates the terms of the platform hosting the repository.

The enforcement agent screens every contribution against this floor before any fee is quoted. The screen can hold a contribution for the owner's review; it can never approve one, and passing it is not a safety check. The owner resolves a hold under Article 6. No vote can override the floor.

## Article 5. Takedown

On receipt of a valid legal notice, or where the owner determines in good faith that content is outside the floor in Article 4, the owner removes the content from the current tree without a vote. History is rewritten only where the notice or the law requires removal of the content itself rather than of its publication. The owner records the action and any notice in the ledger, revokes the weight that the contribution earned, and gives the contributor an opportunity to respond, including the platform's counter-notice route where the notice came through the platform.

## Article 6. Owner powers, exhaustive

The owner is SAPIA TECHNOLOGIES INC., a corporation under the laws of Ontario, Canada. The owner holds exactly these powers and no others:

- the takedown power in Article 5;
- resolving a screening hold under Article 4, by releasing the contribution to a vote or rejecting it, with the reason recorded as the ground of Article 4 relied on and without allegations of fact about any person;
- custody of the repository, its infrastructure, its keys and its name, including moving the repository to another host, recorded in the ledger, with the Laws' references to platform features read as their closest equivalent until a Laws vote updates them;
- designating and rotating the fee destination under Article 7;
- deploying and patching the enforcement agent under Article 8;
- the bootstrap powers in Article 3;
- maintaining `NOTICES.md` and `PRIVACY.md`;
- amending `TERMS.md` after bootstrap only where the law requires it, as Article 13 allows;
- naming replacement or additional owner accounts and keys by a command recorded in the ledger from an account or key then in force, effective fourteen days after it is recorded;
- the duties in Article 14.

The owner has no vote weight. The owner may publish like any contributor, paying the fee, and earns no weight by doing so.

## Article 7. Fees

Every fee is a payment to the owner for the publication service. The initial fee destination is the address `0xfdEd1371127F4c22e2Caf355fB058bDc5f579144` on Base (`eip155:8453`), in USDC. The owner may change the destination only by a command recorded in the ledger from a listed owner account, and the agent quotes only the destination in force when it quotes. Quoted fees include all applicable taxes.

Fees are never refunded on rejection. On expiry they are held under the Laws. Fees are never redistributed to participants.

No Law may set the base fee below **1.00 USDC**. Everything above that is set by the Laws.

Prizes the owner chooses to award come from the owner's own funds and are not governed by this document.

## Article 8. Enforcement agent

The enforcement agent's source lives under `agent/`. It runs on infrastructure the owner operates, and never from this repository's own automation: `.github/` contains no workflows, and the owner keeps the platform's workflow automation disabled for this repository.

Every decision the agent makes is written to `ledger/`, and anyone may replay the ledger against the rules, using nothing outside this repository and the fee network, to verify every outcome. An outcome that replay shows to differ from the rules is corrected by a correction event recorded with the evidence; the original entry remains.

Where the agent's code or the values in `laws.json` disagree with the written rules, the written rules prevail. The owner may patch the code and those values so that they match the written rules. Each patch is recorded in the ledger with its reason and may be reversed by a Laws vote. The patch power may not be used to change a rule.

The owner runs the version of `agent/` at the head of `main`, recording each deployment's commit hash in the ledger. A voted change to `agent/` is deployed no sooner than fourteen days after it merges, and only if replaying the existing ledger with the new code reproduces it. The owner may decline to deploy a version it determines would compromise its keys or infrastructure, recording the reason.

The agent refuses to run under a `laws.json` that fails validation or breaches Article 9A. It continues under the last compliant version and records the refusal.

## Article 9. Weight

Vote weight derives only from fees paid on contributions that were merged, and only from the quoted base fee multiplied by the layer multiplier, never from the size component or from any amount paid above the quote. It decays with time since each merge and matures only after a delay. It is keyed to the account's immutable identifier on the hosting platform, accrues to the account that opened the contribution, cannot be transferred, has no monetary value, and is never reassigned if the account is deleted. The numbers are set by the Laws.

## Article 9A. Minimums the Laws may not cross

No Law may:

- set any vote window below twenty-four hours;
- set any quorum below three distinct non-author accounts voting yes;
- set the Laws majority below two thirds of counted weight;
- make the Laws procedure easier than the World procedure on window, quorum, majority or fee multiplier;
- set the weight half-life below thirty days;
- set weight maturity below fourteen days or above ninety days;
- let any one account count for more than one third of the total mature weight in any tally;
- set the fee cap below two times or above one hundred times the floor;
- set the per-contribution size cap below sixty-four kilobytes or above eight megabytes;
- set the size component of the fee below one hundredth of a USDC per kilobyte, or exempt more than sixty-four kilobytes of a contribution from it;
- hold an expired fee for less than ninety days;
- assign any path outside `world/` to the World;
- treat anything other than the platform's approve and request-changes review states as votes;
- hold an expired fee for more than three hundred and sixty-five days;
- bring a Laws change into effect sooner than seven days after it merges;
- express any formula constant as text the agent evaluates.

Article 7 sets the fee minimum.

## Article 10. Licensing and sign-off

Every contribution of prose, data or other non-code content is released under CC0 1.0 (`LICENSE-CONTENT`). Every contribution under `agent/`, `site/` or `.github/` is licensed under Apache-2.0 (`LICENSE`). Both grants are irrevocable. The files in this repository at the first public commit are released on the same terms. A contribution that incorporates third-party material under a licence requiring attribution or share-alike is not accepted.

Every commit by a contributor carries a Developer Certificate of Origin sign-off (`DCO.md`). Commits by the owner and the agent are identified by the accounts and keys listed in the ledger. Submitting a contribution is acceptance of `TERMS.md`; paying a quoted fee is acceptance of `TERMS.md` at the commit the quote cites.

## Article 11. Transparency

All votes, payments, agent decisions, holds, confirmations, rejections, patches, deployments and takedowns are public in `ledger/`. The ledger records every input to every decision, including each review with its account identifier and timestamp, and each payment's transaction hash, so that replay needs nothing outside this repository and the fee network. Screening holds are recorded but are not replayable.

The ledger is permanent except where Article 5 or the law requires removal; a removal is recorded as a redaction event that keeps the hash of what was removed. Ledger entries are signed with a key whose public half is the Ed25519 key `MCowBQYDK2VwAyEAKPXQD2Sgik3hpo0eJEi8mpAD3fQkz/XVJN1LwhIZ6x4=`, also published as `ledger/public-key.pem`, and the owner anchors the hash of the ledger head on the fee network at each fee adjustment where it can; a missed anchor is recorded and does not affect replay.

The signing key may be replaced. A replacement is a key rotation event, signed by the key in force, naming the public key that signs from the next event on, and citing a commit on `main` by an owner account named in the ledger's first event that announces the same key. Both are required, so a stolen key alone cannot rotate and a stolen account alone cannot either. If the key in force is lost, the owner announces the new key by a transaction on the fee network sent from the fee destination in force and carrying the hash of the new public key; fourteen days after that transaction's block, the new key may sign the rotation event itself, citing the transaction. The block's timestamp cannot be set by anyone, and the destination is held apart from the servers, so a lost key costs fourteen days and a stolen account alone still cannot rotate. A rotation signed by the key in force during those fourteen days prevails. Replay follows the chain of rotations from the key named in this Article.

## Article 12. Forks and the name

Anyone may fork the repository under its licenses. The name Nomicon and its marks belong to the owner and may not be used to present a fork as Nomicon, except as Article 14 provides.

## Article 13. Amendment

The Laws change only by the Laws procedure. After bootstrap, this Constitution and the other files of its layer cannot be amended in this repository by anyone, with one exception. Where a statute, a regulation, or a decision of a court or regulator with jurisdiction over the owner requires a change to `TERMS.md`, the owner may make the smallest change that satisfies it. The owner records the change in the ledger, citing the provision that requires it and the commit holding the new text, and the change takes effect thirty days later, for quotes issued after that moment only; a quote issued before it cites the earlier text and is governed by it. Such a change may not alter any rule of this Constitution or of the Laws, the licences of Article 10, or what the Terms say about fees, votes, weight, removal or continuity, and may not add an obligation on contributors beyond what the cited provision requires. Anyone may compare the two texts against the cited provision; a change that goes further than the provision requires is outside the owner's powers and void. Copies in forks may be altered under their licences, but a fork whose Constitution differs from this one other than as Article 14 allows is not Nomicon.

## Article 14. Continuity

A lapse occurs when either of these holds and no maintenance window the owner declared in advance in the ledger covers the period: a paid contribution has awaited the opening of its window, or a decision after its close, for ninety consecutive days; or the owner has been dissolved according to a public corporate registry.

After a lapse, any contributor may give notice by opening an unpaid pull request titled "Continuity notice" that records the evidence, and by writing to the contact address in `NOTICES.md`. If thirty days after that notice no decision has been recorded in the ledger, contributors may elect a successor operator on that pull request by the Laws procedure, without fee, using the weights in the last published `ledger/state.json`. Any contributor may tally the election with the replay tool; the earliest valid passing election wins, and the tally with its inputs is the first event in the successor's ledger.

The owner grants now, irrevocably and royalty-free, to whichever operator is so elected, a licence to use the name Nomicon for the elected fork, conditional on the fork being operated under this Constitution and these Terms, and ending if it is not. The successor's copies of this Constitution and of `TERMS.md` differ from the originals only by naming the successor as owner and by stating its contact address, its fee destination and its keys. Those substitutions, and the legally required changes Article 13 allows, are the only amendments permitted, and the substitutions only in that fork. The original owner's fee wallet remains the original owner's.
