# 0015. Nightly matrix: timings run alone; harness-limited tests skip by capability

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** CI, tests (nightly workflow, perf, DOM and e2e)
- **Builds on:** ADR-0007 (test architecture)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

The first scheduled nightly run (2026-10-10) failed. That run was also the first time Firefox,
and WebKit in the Vitest DOM project, had run at all. ADR-0013 and ADR-0014 cover the two
failures that were product bugs. The other three were problems with the test setup:

1. **Perf budgets in the full-matrix Chromium job.** `perf.spec.js` ran its timed budgets
   whenever `SG_NIGHTLY=1`, so it ran inside `e2e-full (chromium)` too. That job runs specs
   fully parallel on two workers, and it measured contended frames (scroll 52.7 ms against
   36 ms, drag 56.5 ms against 32 ms). The dedicated `performance` job ran the same spec alone
   and passed.
2. **Synthetic pinch in desktop Firefox and WebKit.** The pinch DOM test builds `Touch` and
   `TouchEvent`. Desktop Firefox has no `TouchEvent`, and desktop WebKit throws "Illegal
   constructor" for `new Touch()`. Pinch zoom listens for touch events, so these engines cannot
   pinch at all. There is nothing to test there.
3. **Release outside the window under Playwright's Firefox.** A probe showed that Playwright's
   Firefox delivers no input at negative coordinates. No `pointermove`, `pointerup` or `mouseup`
   reaches the window, even with pointer capture, while x=0 behaves normally. Chromium delivers
   the captured `pointerup`. The test cannot drive the behaviour it checks in that engine.

## What did we try?

### Raise the perf budgets ❌ rejected

The budgets are already twice the spec's targets. Raising them to absorb contention from a
parallel run would make the dedicated job meaningless.

### Retries ❌ rejected

Playwright already retries once in CI, and both attempts failed. The Vitest DOM tests never
retry, per `docs/testing/flake-policy.md`. These failures are deterministic, so retrying would
not help.

## What did we land on, and why?

- **Timed budgets run only with `SG_PERF=1`.** The nightly `performance` job sets it and runs
  `tests/perf` alone. `SG_NIGHTLY` no longer turns them on. The deterministic perf counts are
  unaffected.
- **Capability skip for synthetic touches.** `canConstructTouches()` in `tests/dom/mobile.test.js`
  tries `new Touch()` and checks for `TouchEvent`. Chromium, which runs on every PR, keeps the
  pinch coverage.
- **A per-engine skip, with the reason in the skip message,** for the release-outside-the-window
  drag test in Firefox. It still runs in Chromium and WebKit.

The whole nightly matrix (DOM in three engines, e2e for chromium, firefox, webkit, pixel, ipad
and iphone, and the perf job) passes locally in the pinned Playwright image.

## What does this cost us?

- Firefox has no automated coverage for releasing a drag outside the window, or for pinch.
  Pinch does not exist in desktop Firefox, and the release path is the same pointer-capture
  code that Chromium and WebKit exercise.
