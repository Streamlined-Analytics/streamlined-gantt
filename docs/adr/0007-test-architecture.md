# 0007. Test architecture: pure engine in Node, UI in real browsers, counts over timings

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** testing
- **Builds on:** none — first ADR for testing
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

Gantt libraries' issue trackers are dominated by date off-by-ones, daylight-saving drift, touch
and drag bugs, listener leaks, and events firing many times per drag. A strong test suite is a
priority, and the 9 October 2026 testing research set the architecture and the definitions of
done.

## What did we try?

### Attempt 1 — node:test for everything ❌ replaced

Scaffolded in M1. It has no browser mode, no per-glob coverage floors and no fake timers. It
was migrated to Vitest before any significant tests existed.

### Attempt 2 — jsdom or happy-dom for UI tests ❌ rejected up front

No layout, scrolling, pointer capture, SVG geometry or `<dialog>` behaviour, which is exactly
where the other libraries' bugs live.

### Attempt 3 — Stryker's Vitest runner ❌ failed in practice

Under Vitest 5 it ran zero or one test per mutant (`testsCompleted: 0`), so mutants "survived"
unexamined. It was replaced by Stryker's command runner, which is slower but correct.

### Attempt 4 — layered suites ✅ chosen

## What did we land on, and why?

- **Engine (Node, no DOM globals):**
  - known-answer fixtures: N1, N1 with a deadline, N1 across Christmas, N2 with mixed links, the
    England and Wales calendar table, and a sample programme from an integrating application, for cross-implementation
    agreement;
  - fast-check properties against naive day-walking and CPM oracles (1,000 runs on PRs, 10,000
    nightly);
  - a model-based undo/redo test;
  - a spy proving no local `Date` arithmetic;
  - a six-time-zone CI matrix;
  - coverage floors (engine branches ≥ 95%).
- **Fixtures are built lazily** (`tests/support/lazy.js`). Anything computed at module scope runs
  before Stryker activates a mutant, so it would hide that mutant.
- **Component and event contract (Vitest browser mode, Chromium on PRs, three engines nightly):**
  - row-count bounds under virtualisation;
  - a catalogue-coverage test with one trigger per event, checking the DOM mirror's identity,
    bubbling and cancelability;
  - drag via PointerEvents, including touch;
  - keyboard and custom-element lifecycle tests;
  - listener, observer, timer and frame counters across 50 htmx swaps.
- **End to end (Playwright):**
  - Chromium plus Pixel (CDP trusted touch), and WebKit plus iPad (synthetic pointer events);
  - every example page as a smoke test;
  - axe with the WCAG 2.2 AA tags;
  - WeakRef garbage-collection checks;
  - burn-in of changed specs ten times on PRs.
- **Visual:** only in `mcr.microsoft.com/playwright:v1.63.0-noble` (pinned by digest in CI),
  with a fixed clock and `maxDiffPixelRatio 0.001`. Locally, run `npm run test:visual` (Docker;
  on SELinux hosts the volume needs `:Z`).
- **Performance:** deterministic counts on PRs (rows rendered, elements created per scroll).
  Timings use generous budgets on PRs and run nightly.
- **Mutation:** Stryker on `src/engine`, `src/io` and history, weekly.

## What does this cost us?

- CI minutes: about 12 parallel jobs per PR. The Hetzner runner pool could take these later.
- The Docker-only visual workflow is slower to update; baselines are reviewed as images in PRs.
