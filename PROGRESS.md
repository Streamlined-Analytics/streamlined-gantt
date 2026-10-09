# Progress

Status of the streamlined-gantt MVP against the spec (§3.11) and the testing guidance. Updated
9 October 2026. The repository is private and nothing is published to npm.

## Milestones

| Milestone             | Scope                                                                                                                                                                          | State       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| M1 Scaffolding        | Licence, NOTICE, CLA (draft), community files, CI, build, banners, size budget                                                                                                 | Merged (#1) |
| M2 Engine             | Dates, calendars, CPM (FS/SS/FF/SF, lags, constraints, progress, data date, modes), validation, fields, summaries, health, CSV, formatting                                     | Merged (#3) |
| M3 Rendering          | Virtualised treegrid, SVG timeline, scale, markers, baselines, critical path, compact mode                                                                                     | Merged (#5) |
| M4 Editing (headline) | Pointer and touch drag (move, resize, progress, link), live cascade preview, keyboard alternatives, editor, menu, tooltip, picker, undo, approvals, element and htmx lifecycle | Merged (#5) |
| M5 Print              | A3/A4 print, SVG and PNG export, title block, legend                                                                                                                           | Merged (#5) |
| M6 MSPDI              | Lossless import and export, recurring calendars, XXE-safe parser, nightly MPXJ samples (ADR-0008)                                                                              | Merged (#5) |
| Theming               | Tokens for every visual value, dark mode, per-item colour, JS theme API, playground (ADR-0009)                                                                                 | Merged (#5) |
| Integration           | htmx save-back, fetch approval, mock backend, custom editor, read-only view, strict CSP                                                                                        | Merged (#5) |

## Acceptance criteria

Each line is checked by the tests named.

### Editing and integration

- Dragging moves, resizes and links bars; successors reschedule on working days; one `change`
  per transaction: `tests/dom/drag.test.js`, `tests/e2e/drag-*.spec.js`.
- Every drag has a keyboard alternative, the treegrid passes axe, and there is one tab stop:
  `tests/e2e/keyboard.spec.js`, `tests/a11y/axe.spec.js`.
- Approve, reject and correct, via htmx and via `fetch`: `tests/e2e/integration.spec.js`.
- htmx swaps never leak instances or listeners: `tests/memory/htmx-gc.spec.js`.
- Strict CSP produces zero violations: `tests/e2e/strict-csp.spec.js`.

### Engine

- Scheduling matches an independent CPM oracle (property tests at 1,000 runs on PRs and 10,000
  nightly, in six time zones): `tests/property/*`.
- SA website data (PR #446) schedules to the same finish as its Python model:
  `tests/unit/integrator-contract.test.js`.

### MSPDI

- Round trips are deep-equal, and re-export is byte-identical, for every fixture and for random
  programmes: `tests/io/mspdi*.test.js`.
- Files from other tools import with warnings for anything dropped; MPXJ samples are checked
  nightly: `tests/io/mpxj.nightly.test.js`.

### Theming

- No raw colour outside the token block or in rendering JS; every token is defined and
  documented: `tests/unit/theme-tokens.test.js`.
- Categories, `style.color`, callbacks, link colours, contrast-safe labels, critical-path
  precedence, geometry tokens, host CSS beating the layer, dark mode by option, by
  `[data-theme]` and through DaisyUI variables, and print resolution:
  `tests/dom/theme.test.js`.
- Visual snapshots of the light, dark and brand themes in the pinned Playwright image:
  `tests/visual/visual.spec.js`.
- axe colour contrast on the dark, brand and DaisyUI themes and in OS dark mode:
  `tests/a11y/axe.spec.js`.

### Packaging and performance

- Core bundle at most 45 KB gzip, each IO module at most 10 KB, licence banners present:
  `scripts/check-size.mjs`, `scripts/check-banner.mjs`.
- Declarations work for a TypeScript consumer, and the pack is clean:
  `tests/types/consumer.ts`, `scripts/pack-smoke.mjs`.
- 1,000 tasks / 1,500 links within twice the spec budgets (nightly): `tests/perf/*`.

## Tests

- Engine and IO (Node): 499, plus 6 nightly-only MPXJ checks.
- Browser components (Vitest, Chromium): 166.
- End-to-end, a11y, memory and print (Playwright, Chromium): 50. WebKit, iPad and Pixel run in CI.
- Visual: 13 snapshots in the pinned Playwright image.
- Property tests run 1,000 times per property on PRs and 10,000 nightly. Mutation testing (Stryker) runs weekly.

## Measured

|                                           | Value                            | Budget |
| ----------------------------------------- | -------------------------------- | ------ |
| Core ESM bundle                           | 43.52 KB gzip                    | 45 KB  |
| Script-tag bundle (core, editor, toolbar) | 46.01 KB gzip                    | 48 KB  |
| CSS                                       | 3.92 KB gzip                     | 6 KB   |
| MSPDI module                              | 9.98 KB gzip                     | 10 KB  |
| First render, 1,000 tasks / 1,500 links   | 71 ms                            | 250 ms |
| Scroll frame (p90)                        | 17.6 ms (about 57 fps)           | 55 fps |
| Drag frame overhead (p90)                 | 1.7 ms                           | 16 ms  |
| `schedule()`, 1,000 tasks / 1,500 links   | 3.0 ms (Node), 3.4 ms (Chromium) | 30 ms  |

## Remaining

- The core is at 43.52 of 45 KB after moving the editor dialog to an optional entry. Larger
  core features will need a budget decision.
- Lookahead print layout and the warnings panel for `check()` (UI), which the spec lists after
  drag editing.
- Solicitor review of `CLA.md`; confirm the code-of-conduct contact address.
- Real MS Project and Asta exports from Ben, to add as fixtures when available.
