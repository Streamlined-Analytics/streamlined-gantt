# Contributing to streamlined-gantt

Thank you for your interest. Please read this page before opening an issue or pull request.

> **External contributions are paused until the CLA has been reviewed.** The Contributor
> License Agreement in [CLA.md](CLA.md) is a **draft, to be reviewed by a solicitor before
> Streamlined Analytics accepts external contributions**. Until then, please open issues and
> discussions rather than pull requests. Pull requests from people outside Streamlined
> Analytics will be left open, not merged, until the reviewed CLA is in place.

## Scope first

streamlined-gantt is a framework-free Gantt chart and scheduling library for small and
medium-sized teams. It is deliberately **not** Primavera P6 or Microsoft Project. Every feature
request must name the project workflow it serves.

**Non-goals** (pull requests adding these will be declined):

- resource levelling, cost loading or earned value management
- multi-project portfolio management
- real-time multi-user co-editing (backends broadcast changes through `applyPatch()`)
- runtime dependencies of any kind, including UI frameworks
- network calls made by the library itself (the host page owns all I/O)

## Support

Support is **best effort, triaged weekly**. Bug reports must include a minimal programme JSON
fixture that reproduces the problem; the issue template explains how. Commercial support and
bespoke integration are available from
[Streamlined Analytics](https://streamlinedanalytics.co.uk).

## Contributor License Agreement

All contributors sign the Individual Contributor License Agreement in [CLA.md](CLA.md), adapted
from the Apache Software Foundation's ICLA. The CLA Assistant Lite bot prompts you on your first
pull request; signatures are stored in `signatures/version1/cla.json` on the `cla-signatures`
branch. We use a CLA rather than the DCO so that Streamlined Analytics keeps the option to
relicense the project in future (see [ADR-0005](docs/adr/0005-apache-2-licence-and-cla.md)).

## Development

Requirements: Node.js 20 or later.

```sh
npm ci
npm run check          # lint, type-check, SPDX headers, engine tests + coverage floors, build, banner, size
npx playwright install chromium webkit
npm run test:dom       # Vitest browser-mode component tests (Chromium)
npm run test:e2e       # Playwright end-to-end tests (set SG_BROWSERS=chromium to skip WebKit)
npm run test:mutation  # Stryker on the engine (slow; runs weekly in CI)
npm run serve          # examples at http://127.0.0.1:4173/
```

### Tests

The test architecture follows `docs/testing/` (see the flake policy there):

- `tests/unit`, `tests/property`: the DOM-free engine in Node, with known-answer fixtures and
  fast-check properties against the naive oracles in `tests/support/`. `SG_FC_RUNS` sets the
  number of property runs (1,000 on PRs, 10,000 nightly). CI runs them in six time zones.
- `tests/dom`: Vitest browser mode in real browsers. jsdom and happy-dom are not used.
- `tests/e2e`, `tests/a11y`, `tests/visual`, `tests/print`, `tests/memory`, `tests/perf`:
  Playwright. Visual baselines are generated only in the pinned Playwright Docker image.
- Build engine fixtures lazily (`tests/support/lazy.js`), never at module or `describe` scope, so
  mutation testing can see them.

### Code rules

- Plain ES2022 JavaScript with JSDoc types. TypeScript is a dev-time checker only.
- Every source, test, script and example file starts with the SPDX header:
  ```js
  // SPDX-License-Identifier: Apache-2.0
  // Copyright 2026 Streamlined Analytics Ltd and contributors
  ```
- Small modules, guard clauses rather than nested `if`/`else`, and named predicates for
  conditions with more than one clause.
- Explanations belong in JSDoc. Do not write comments that narrate the code.
- The scheduling and calendar engine (`src/engine/`) must stay pure: no DOM, no `Date` parsing,
  no I/O. Dates are integer day numbers internally and ISO `YYYY-MM-DD` strings at the boundary.
- Money is integer minor units (pence). Never do floating-point arithmetic on money.
- User text is rendered with `textContent`. HTML needs an explicit `trustedHTML()` opt-in.
- Every behaviour change carries a test. Engine changes need unit or property tests; UI changes
  need Playwright coverage.
- Significant decisions get an ADR in `docs/adr/`.

### Dependencies

Development dependencies are pinned to exact versions that were published at least two weeks
before they were added (`npm install --before=<date>`), and Dependabot runs with a seven-day
cooldown. Runtime dependencies are not accepted.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open public issues for vulnerabilities.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
