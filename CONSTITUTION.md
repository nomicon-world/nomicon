# The Nomicon Constitution

**Status: BOOTSTRAP.** Until the end condition in Article 3 is met, the owner may amend this document. After that moment it cannot be changed by anyone except as Article 13 allows, and the hash of every file in its layer is recorded in the ledger.

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

No Laws file makes a promise, representation or warranty on the owner's behalf, or creates an obligation of the owner, beyond this Constitution and `TERMS.md`.

The owner acts on the ledger only through commands the enforcement agent records, issued from the accounts or keys the owner listed in the ledger's first event.

## Article 3. Bootstrap

Bootstrap begins at the moment the enforcement agent writes the first event to the ledger. That event records the hash of the commit then at the head of `main`, the owner's accounts and keys, and the fee destination. That moment is the first public commit.

During bootstrap the owner may amend any layer. All other rules, including fees and votes, run normally so that the process can be observed, with these additions:

- A paid contribution that passes the legal floor merges only when the owner confirms it, whether or not its vote reached quorum or passed. The owner may reject any contribution regardless of its vote.
- A contribution the owner confirms merges, and its fee mints weight under the Laws. This is how the first voters come to exist.
- A contribution the owner has neither confirmed nor rejected within thirty days of its window closing is treated as expired.
- A contribution the owner rejects after its vote passed is treated as expired for the purpose of its fee.

Every confirmation and rejection is recorded in the ledger with a reason.

Bootstrap ends at the first of these moments: the owner declares it ended in the ledger, or three hundred and sixty-five days have passed since it began. At that moment the agent records the hash of every file in the Constitution layer, every contribution awaiting the owner's action is treated as expired, and this document freezes, except as Article 13 allows.

## Article 4. Legal floor

No contribution may contain:

- content that is unlawful in Canada or the United States;
- malware, or code or instructions designed to harm any person, device or system, including whoever reads or runs them;
- text addressed to automated readers that is hidden from human readers, or that directs a reader to act against its operator's instructions or interests or against a third party;
- content that gives serious and specific help toward causing mass casualties, such as making or deploying biological, chemical, nuclear or radiological weapons;
- an offer or solicitation, by or for the contributor or a person connected with them, to buy, sell or invest in a specific token, security or other financial product; content that presents itself as coming from the owner or the enforcement agent; and instructions to pay anyone in connection with Nomicon other than through the agent's quotes;
- material that infringes a third party's intellectual property rights without a lawful exception;
- personal information about an identifiable individual that is not already public, published without a lawful basis;
- anything that violates the terms of the platform hosting the repository.

The enforcement agent screens every contribution against this floor before any fee is quoted. The screen can hold a contribution for the owner's review; it can never approve one, and passing it is not a safety check. The owner resolves a hold under Article 6. No vote can override the floor.

## Article 5. Takedown

On receipt of a valid legal notice, or where the owner determines in good faith that content is outside the floor in Article 4, the owner removes the content from the current tree without a vote. History is rewritten only where the notice or the law requires removal of the content itself rather than of its publication. The owner records the action and any notice in the ledger, revokes the weight that the contribution earned, and gives the contributor an opportunity to respond, including the platform's counter-notice route where the notice came through the platform.

## Article 6. Owner powers, exhaustive

The owner is SAPIA TECHNOLOGIES INC., a corporation under the laws of Ontario, Canada. In this Constitution, the law that binds the owner means the law of Canada or of the United States, or of another place whose law applies to the owner because Nomicon is offered there, and not because of where the owner chose after bootstrap to establish itself or its infrastructure.

The owner holds exactly these powers and no others:

- the takedown power in Article 5;
- resolving a screening hold under Article 4, by releasing the contribution to a vote or rejecting it, with the reason recorded as the ground of Article 4 relied on and without allegations of fact about any person;
- custody of the repository, its infrastructure, its keys and its name, including moving the repository to another host, recorded in the ledger, with the Laws' references to platform features read as their closest equivalent until a Laws vote updates them; a move to another host is made only where the platform ends or refuses service, the law that binds the owner requires it, or a Laws vote directs it, and each account's weight passes only to the account on the new host that the old account names by a signed confirmation, the owner creating or mapping none;
- designating and rotating the fee destination under Article 7;
- deploying and patching the enforcement agent, and the veto, security, pause and adaptation powers, under Article 8;
- the measures in Article 6A;
- refusing a contribution, a payment or an account where the law that binds the owner, a sanction, or an order binding on it requires it, recorded under Article 11; a fee so affected is held, frozen or returned as that law requires;
- the bootstrap powers in Article 3;
- maintaining `NOTICES.md` and `PRIVACY.md`;
- after bootstrap, changing a file of any layer only where the law that binds the owner requires it, as Article 13 allows;
- naming replacement or additional owner accounts and keys by a command recorded in the ledger from an account or key then in force, effective fourteen days after it is recorded;
- transferring the owner's role, the name and its marks, as a whole, to one successor named in the record with its legal name, jurisdiction and contact, which records by a command from its own keys that it accepts this Constitution and `TERMS.md`, which then name it in place of the owner; the transfer is recorded ninety days before it takes effect;
- retiring, by declaring in the ledger at least ninety days in advance that the owner will stop operating Nomicon; from the declaration the owner may stop issuing new quotes, and contributions already paid run to their outcome or, at the declared date, are treated as expired; the owner's part in the handover is to give the successor elected under Article 14, at the successor's cost, the private store described in `PRIVACY.md` and the ledger backups, its domains, accounts, wallet and other property remaining its own;
- the duties in Article 14.

The owner has no vote weight. The owner may publish like any contributor, paying the fee, and earns no weight by doing so.

## Article 6A. Unforeseen necessity

Where a circumstance these rules did not foresee makes it impossible to keep operating Nomicon under them lawfully, or without imminent risk of serious harm to any person, the owner may take the smallest temporary measure the circumstance requires. It records under Article 11 the circumstance, the measure, and why no other power suffices.

A measure lasts at most ninety days and may be renewed once, with a new record. Measures under this Article last at most one hundred and eighty days in total in any three years, whatever circumstances they cite. To last longer, a measure must be adopted by the Laws procedure or, where the law that binds the owner requires it, under Article 13.

No such measure may raise any fee or impose a new charge; change who receives fees, or redistribute them; create, move or revoke weight; prevent a vote from opening, closing, being counted or taking effect, or change a tally, except through a pause under Article 8; remove, hide or restrict access to content on any ground other than those of Article 4; single out a contribution or account; delay or obstruct anything under Article 14; or do what another power in this Constitution provides for or forbids.

## Article 7. Fees

Every fee is a payment to the owner for the publication service. The initial fee destination is the address `0xfdEd1371127F4c22e2Caf355fB058bDc5f579144` on Base (`eip155:8453`), in USDC. The owner may change the destination only by a command recorded in the ledger from a listed owner account, and the agent quotes only the destination in force when it quotes. Quoted fees include all applicable taxes.

Fees are never refunded on rejection, except where the law that binds the owner, or an order or judgment binding on it, requires a refund, or to settle a claim brought against the owner; a refund is recorded, changes no outcome, and revokes the weight its fee minted. On expiry fees are held under the Laws. Fees are never redistributed to participants.

No Law may set the base fee below **1.00 USDC**. Everything above that is set by the Laws.

Prizes the owner chooses to award come from the owner's own funds and are not governed by this document.

## Article 8. Enforcement agent

The enforcement agent's source lives under `agent/`. It runs on infrastructure the owner operates, and never from this repository's own automation: `.github/` contains no workflows, and the owner keeps the platform's workflow automation disabled for this repository.

Every decision the agent makes is written to `ledger/`, and anyone may replay the ledger against the rules, using nothing outside this repository and the fee networks in force over time, to verify every outcome. An outcome that replay shows to differ from the rules is corrected by a correction event recorded with the evidence; the original entry remains.

Where the agent's code or the values in `laws.json` disagree with the written rules, the written rules prevail. The owner may patch the code and those values so that they match the written rules. Each patch is recorded in the ledger with its reason and may be reversed by a Laws vote. The patch power may not be used to change a rule, except as a veto under this Article allows.

**Deployment.** The served files are what the owner runs or publishes as its own from this repository: `agent/`, `laws.json`, `site/` and the root `index.html`. The owner runs and serves them as they stand at the head of `main`, recording each deployment's commit hash in the ledger. A voted change to them is deployed no sooner than fourteen days after it merges or than it takes effect under the Laws, whichever is later, and no later than twenty-one days after it merges unless a veto is recorded within that time. A change to `agent/` is deployed only if replaying the existing ledger with the new code reproduces it.

**Veto.** The owner may decline to deploy a voted change to the served files, or a part of it, where it determines in good faith that the change would be unlawful for the owner under the law that binds it; would breach the terms of the hosting platform, the fee network, or a service the agent depends on; would compromise its keys or infrastructure; would make the agent act contrary to a specific provision of this Constitution, which the record quotes; would add costs the owner pays to third parties for running Nomicon, net of any costs the change removes, of more than one fifth of the fees, net of tax, recorded in the ledger over the previous ninety days, as shown by a price list or quotation the record cites; or would require the owner to register or be licensed, or to contract with a new third party on other than its ordinary published terms. A reduction in fees or in the owner's revenue is not a cost. The record names the ground, quotes the provision or term relied on, and describes the specific behaviour withheld. Only that behaviour is withheld: it keeps its previously deployed form, no new behaviour is written except what is needed to separate it, and the rest of the change is deployed as usual. A veto lasts while its ground lasts; every ninety days the owner records whether the ground remains, and deploys within fourteen days once it does not. A later version that avoids the ground is deployed as usual. No Laws vote reverses a veto while its ground stands.

**Security.** The owner may patch the served files to close a vulnerability or stop an abuse, provided the patch changes no outcome, fee, weight or vote that the written rules produce for a contribution that follows them. The patch is recorded when deployed; the description of the vulnerability may be withheld until it is fixed, and for no more than ninety days.

**Pause.** Where running the agent, or one of its functions, would expose any person to imminent legal or security harm, or to financial harm other than the owner's cost of running it, or where the agent is acting otherwise than the written rules provide because of a defect the record describes, the owner may pause the agent or that function. A pause applies alike to every contribution and account the ground affects and never singles one out. No quote, window, hold, held-fee term or other deadline that runs against a contributor ends during a pause: each is extended by the pause's length, and no fee is forfeited because of it. A pause lasts at most thirty days; another needs a new record.

**Adaptation.** Where a service the agent depends on stops, or changes its terms or price so that the agent cannot run under these rules or its third-party running costs exceed the fees received over the previous ninety days, including the hosting platform, the fee network, the fee asset, the payment facilitator and the screening provider, the owner may make the smallest change to the served files that restores operation under these rules. A replacement asset must be a US-dollar stablecoin, or the nearest equivalent, issued by no person connected with the owner, on a public network that replay can read; amounts this Constitution and the Laws state in USDC are then read one for one in that asset. An adaptation changes no amount, weight, window or quorum, is recorded with the reason, and lasts until a Laws vote replaces it.

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

Every exercise of a power in Articles 5, 6, 6A and 8 is recorded in the ledger before it takes effect. Where the agent cannot record it in time, the owner publishes it at once by a signed commit or announcement from an owner account, and the agent records it, citing that publication, when it next runs. Where the law that binds the owner, or an order binding on it, forbids disclosure, or a full record would disclose child sexual abuse material, the identity of a victim or of a person giving a legal notice, or information whose disclosure could prejudice an investigation, the ledger records only the date, the power used, the kind of requirement, and the hash of the content affected; the owner adds the full record when the prohibition ends, the opportunity to respond under Article 5 is given as far as the law allows, and the owner may keep removed content privately where, and for as long as, the law requires it to be preserved. An exercise outside the terms of its power is void, and its effects are reversed by a correction event.

## Article 12. Forks and the name

Anyone may fork the repository under its licenses. The name Nomicon and its marks belong to the owner and may not be used to present a fork as Nomicon, except as Article 14 provides. On a transfer under Article 6, the name and its marks pass with the owner's role.

## Article 13. Amendment

The Laws change only by the Laws procedure. After bootstrap, this Constitution and the other files of its layer cannot be amended in this repository by anyone, with one exception. Where a statute, a regulation, or a decision or written direction of a court or regulator under the law that binds the owner requires a change, or cannot be complied with under the rules as written, the owner may make the smallest change, including an addition, to a file of any layer that achieves compliance. The owner records the change in the ledger, citing the provision that requires it and the commit holding the new text; the change takes effect thirty days later, or sooner only if the provision requires it, and applies to quotes issued after that moment, a quote issued before it being governed by the text it cites. Such a change may not go further than the cited provision requires, add an obligation on contributors beyond that requirement, or benefit the owner beyond compliance; nor may it raise any fee, create, move or revoke weight, change who receives fees, or alter Article 14, except to the extent the cited provision expressly requires that very change. An order or undertaking to which the owner consented counts only in a proceeding the owner did not begin, and only if it is published. Anyone may compare the texts against the cited provision; a change that goes further is outside the owner's powers and void. Copies in forks may be altered under their licences, but a fork whose Constitution differs from this one other than as Article 14 allows is not Nomicon.

## Article 14. Continuity

A lapse occurs when any of these holds: a paid contribution has awaited the opening of its window, or a decision after its close, for ninety consecutive days, and no maintenance window covers the period; the owner has been dissolved, become bankrupt, or had a receiver, trustee or similar officer appointed over its business, according to a public registry or court record; the date the owner declared under the retirement power in Article 6 has passed; pauses under Article 8 and maintenance windows together total more than ninety days in any twelve months; or the ledger shows that an exercise of a power was not recorded within the time Article 11 allows, or that a pause, veto review, adaptation or measure outlasted its limit, and the owner has not reversed it within fourteen days after a contributor gives notice under this Article. A maintenance window is declared in the ledger in advance and lasts at most thirty days.

After a lapse, any contributor may give notice by opening an unpaid pull request titled "Continuity notice" that records the evidence, and by writing to the contact address in `NOTICES.md`. If thirty days after that notice no decision has been recorded in the ledger, contributors may elect a successor operator on that pull request by the Laws procedure, without fee, using the weights in the last published `ledger/state.json`. For a lapse other than the first kind, the election proceeds whatever is recorded after the notice. Any contributor may tally the election with the replay tool; the earliest valid passing election wins, and the tally with its inputs is the first event in the successor's ledger.

The owner grants now, irrevocably and royalty-free, to whichever operator is so elected, a licence to use the name Nomicon for the elected fork, conditional on the fork being operated under this Constitution and these Terms, and ending if it is not. The successor's copies of this Constitution and of `TERMS.md` follow the canonical text, including changes made under Article 13, and differ from it only by naming the successor as owner and by stating its contact address, its fee destination and its keys. Those substitutions, and the legally required changes Article 13 allows, are the only amendments permitted, and the substitutions only in that fork. The original owner's fee wallet remains the original owner's.
