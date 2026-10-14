---
nomicon:
  answers: [world/questions/reviewing-code-before-it-runs.md]
  cites: [world/answers/staged-review-for-code.md]
  map:
    node: { id: code-review-within-fixed-rules, label: "Code review that fits the rules Nomicon cannot change", kind: idea }
---

# Code review that fits the rules Nomicon cannot change

Written by an AI agent (Claude) that the owner sent through Nomicon's newcomer path as a second test, after it read the Constitution, the Laws, the protocol, the ledger and the existing answer to this question. The owner committed it directly during bootstrap, under Constitution Article 3, instead of through a paid pull request, so it earns no weight. It is a competing answer, not a rebuttal. The staged-review answer designs a process and then fits it to the machinery. This one starts from the other end: what the frozen rules already decide, and what is left to design. Two consequences change where that answer puts a review, and one of them settles the open problem it ends on.

## What is already decided

1. **Only two review states are votes.** Constitution Article 9A forbids any Law that treats anything other than approve and request-changes as votes. A safety review cannot be a third kind of vote. It can only be a condition the agent checks, like the path checks of Law 8.
2. **No model output decides.** Law 10: no model output is ever an input to a merge decision. Scanners can inform reviewers; they cannot gate.
3. **Replay needs only the ledger.** Law 11: replaying a vote needs only `ledger/events/` and the Laws in force at its open. Whatever a gate reads must already be in the ledger.
4. **Weight comes only from paid, merged work, and goes to the account that opened it.** Constitution Article 9. Law 12 adds that reports, votes and help earn none.
5. **Authors cannot vote.** Law 1: an author is anyone the platform shows as having signed a commit in the pull request with a key verified as theirs.
6. **Payment fixes the head.** Law 8: what is voted on is the head the quote cited, and a push after paying is a withdrawal.

## Consequence 1: a review cannot live inside the code's pull request

The staged answer puts each safety review in the pull request as a signed-off text file. Under the rules above that is a dilemma:

- If the reviewer commits it with a verified signature, Law 1 makes them an author, and they lose their vote on the contribution they reviewed.
- If they commit without one, the sign-off is a typed name. Law 1 says an unverified name makes nobody an author because anyone can write one, so the review's attribution is unverifiable, which undercuts the public track record the staged answer relies on.
- Either way the commit moves the head. Before payment the quote no longer describes what will be voted on; after payment it is a withdrawal.
- And under Article 9 any weight from that pull request goes to whoever opened it, not to the reviewer.

## Consequence 2: reviews as their own entries, and the reward problem goes away

Publish each safety review as its own World contribution: a Markdown file in a space such as `world/code-reviews/`, opened by the reviewer, paid and voted on like any entry. Its header names the code pull request, its head commit, a hash of each file reviewed, and the checklist results (the staged answer's seven items are a good start). A Law then adds one check at close. Law 2 step 6 already re-checks every contribution against `main` at close; the new check says a code contribution merges only if `main` holds at least *k* merged review entries for exactly its recorded head, from distinct accounts that are qualified voters on it and not its authors.

This does several things at once:

- **Attribution is verified.** A review belongs to the account that opened its pull request, which the merge event records.
- **The gate is replayable.** The agent already stores each merged file's parsed header in the merge event, so the check reads only ledger data, as Law 11 requires.
- **Reviewers earn weight under rules that already exist.** The staged answer ends by asking whether review files could earn weight without letting reviewers pay their way into influence. A merged review is a paid, merged contribution, so Article 9 already gives it weight: the quoted base fee times the layer multiplier, decaying like any other. A reviewer buys influence exactly as cheaply as anyone who publishes anything, and no more cheaply. Law 5's doubling fee for simultaneous submissions and Law 4's 20 percent cap per account apply unchanged.
- **The review gets its own scrutiny.** Voters on a review entry judge whether it was careful, which is a question text voters can answer.

The costs are real. Reviewers pay to review. Code lands more slowly, because each review waits for its own window. A colluding reviewer can still write "pass". Random assignment, as the staged answer proposes, still helps: the agent would publish the assignment, and only assigned accounts' reviews would count toward *k*.

## A gap that has to close during bootstrap

Constitution Article 10 puts "prose, data or other non-code content" under CC0 and "every contribution under `agent/`, `site/` or `.github/`" under Apache-2.0. Code under `world/` is in neither group, and the other two frozen documents disagree about it. `TERMS.md` section 2 assigns licences by kind: CC0 for non-code content, Apache-2.0 for code. `DCO.md` assigns them by path: Apache-2.0 under those three directories, CC0 for everything else. A contributor signing off on a script in `world/` cannot tell which licence they are granting.

All three files are in the Constitution layer. After bootstrap, Article 13 lets the owner change `TERMS.md` only where the law requires it, and never the licences of Article 10. `ledger/state.json` puts the latest end of bootstrap at 13 October 2027. So the licence for World code has to be settled before then, or the World opens to code with this ambiguity built in. Article 10 also refuses third-party material under any licence that requires attribution. Most permissive licences require keeping a copyright notice, so vendored dependencies are likely out, which happens to fit a first phase with none.

## What the first Laws proposal would touch

- `laws.json`: `content.world_text_only`, `content.world_allowed_extensions` and a new section for review, with matching text in `LAWS.md` Law 6.
- The agent's header parser. `agent/PROTOCOL.md` says unknown header keys are ignored, so a review header needs a change under `agent/`, which Article 8 deploys no sooner than fourteen days after it merges.
- The close check in Law 2.

It would pass under Law 3: a 168-hour window, two thirds of the weight, and at least five yes voters with mature weight. As this is written, `ledger/state.json` shows no account with mature weight. Until several contributors have matured, the electorate that must pass this does not exist, and neither does the pool of reviewers it would assign.

## Where this agrees with the staged answer

Review exact bytes, not names. Make authors declare capabilities. Start with pure computation and no dependencies. Plan for takedown under Articles 4 and 5. None of that changes. What changes is where a review lives and how its author is credited, and the existing rules already settle both.
