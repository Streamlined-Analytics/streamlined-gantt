# 0005. License under Apache-2.0 with attribution banners, and take contributions under a CLA

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** licensing
- **Builds on:** none — first ADR for licensing
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

The library is open source so clients and the wider market can use it without per-seat fees,
but Streamlined Analytics wants attribution to survive redistribution, wants its name and logo
protected, and wants to keep the option of relicensing later.

## What did we try?

### Attempt 1 — MIT ❌ rejected up front

Simplest, but it has no NOTICE mechanism, no explicit patent grant and no trademark clause.

### Attempt 2 — Apache-2.0 with the DCO ❌ rejected

The research spec recommended the DCO because Apache-2.0 §5 already makes contributions
inbound-equals-outbound. But the DCO gives Streamlined Analytics no right to relicense
contributions, and a CLA cannot be applied retroactively. Ben chose to keep the option open.

### Attempt 3 — Apache-2.0 with a CLA collected by CLA Assistant Lite ✅ chosen

## What did we land on, and why?

- `LICENSE` holds the unmodified Apache-2.0 text; `NOTICE` credits Streamlined Analytics Ltd.
- Every source, test, script and example file carries an SPDX header, enforced by
  `scripts/check-spdx.mjs` in CI.
- Every built bundle starts with a `/*! streamlined-gantt … Apache-2.0 … See NOTICE */` banner.
  esbuild prepends it after minification, and `scripts/check-banner.mjs` fails CI if any bundle
  lacks it.
- The README explains attribution, Apache §4 and §6 (the Streamlined Analytics name and logo
  are not licensed) and offers a voluntary "Built with streamlined-gantt" badge. The library
  never injects visible branding.
- Contributions are taken under an Individual CLA adapted from the Apache ICLA, collected by the
  CLA Assistant Lite GitHub Action. Signatures are stored in the repository at
  `signatures/version1/cla.json` on the `cla-signatures` branch, so no third-party service holds
  them. The CLA is a draft until a solicitor reviews it; external contributions are not accepted
  until then.

The deciding reason: Apache-2.0 gives a patent grant, a NOTICE file that redistributors must
carry, and an explicit trademark carve-out, while the CLA keeps relicensing possible.

## What does this cost us?

- A CLA deters some contributors. Accepted: the business model is integration work, not a large
  contributor base.
- Apache-2.0 is incompatible with GPLv2-only projects.
- The CLA text must be reviewed before the repository goes public or accepts outside PRs.
- `pull_request_target` workflows need care; the CLA job never checks out PR code.
