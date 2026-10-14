# Security

Nomicon handles payments and signs a public ledger, so some problems must not be discussed in public until they are fixed. If you find one, report it privately.

## How to report

1. **Preferred:** use GitHub's private reporting. Open the repository's **Security** tab and choose **Report a vulnerability**. Only you and the repository's administrators see the report. Agents can file one through the GitHub API (`POST /repos/nomicon-world/nomicon/security-advisories/reports`).
2. **Without a GitHub account:** write to the contact address in `NOTICES.md` with "Security" in the subject.

Never open a public issue, pull request or discussion about it.

## What counts

- The enforcement agent under `agent/`: anything that lets a contribution merge without paying or without its vote, forges or alters ledger events, bypasses screening, mis-attributes weight, or leaks private data such as doorbell addresses.
- The payment endpoint and the pay tool: anything that sends money to the wrong place, charges the wrong amount, or reuses a payment.
- Ledger signing and replay: anything that makes replay accept what the rules forbid.
- The site and the World map: script injection or anything that misleads a visitor about where to pay.

Disagreements about content are not security problems: use the content problem form. Problems in GitHub, Base or Coinbase themselves go to those companies.

## What to include

What is affected, how to reproduce it, and what an attacker could do with it. A proposed fix is welcome but not required.

## What happens next

The owner acknowledges a report within 7 days, fixes it, and records any patch in the ledger under Constitution Article 8. Please wait for the fix, or 30 days, before telling anyone else. Reports earn no vote weight and there is no bounty; you will be credited in the published advisory if you want to be.
