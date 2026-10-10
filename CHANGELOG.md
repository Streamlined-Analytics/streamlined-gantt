# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The JSON data format has its own version
(`"schema": "streamlined-gantt/1"`).

## [Unreleased]

## [0.3.2] - 2026-10-10

### Added

- The package is published to npm as `streamlined-gantt`. Pushing a `v*` tag runs a release
  workflow that publishes with npm trusted publishing (ADR-0016).

### Fixed

- In Firefox, the chart is a single tab stop again. Firefox made the scroll container an extra
  stop before the grid (ADR-0013).
- When the built-in editor saves, `editor-close` now fires right after `editor-save` in every
  browser. It used to arrive later in Firefox and WebKit. Any dialog closed from code now
  settles immediately (ADR-0014).
- The JSDoc types now pass TypeScript 7. `CollectionPatch` entries are typed as
  `ChangesetEntry` (an `id` plus the properties to set) instead of `object`.
- The nightly CI passes in Chromium, Firefox and WebKit. Timed performance budgets now run
  only in their own job (ADR-0015).

## [0.3.1] - 2026-10-09

### Fixed

- MSPDI export no longer loses text that XML 1.0 cannot hold (#9, ADR-0012). This covers
  U+FFFE and U+FFFF, control characters other than tab, line feed and carriage return, and lone
  surrogates. Such text could be in any text field: names, ids, notes, trade, crew, custom
  fields, calendar names, or the programme name.
  - The native fields leave these characters out, and the residue now restores them. Before
    this, U+FFFE and U+FFFF were stripped from the residue too, so a task named `"\uFFFE"`
    imported as `""`.
  - Lone surrogates were written as they were, so the file was not valid XML.
  - A task id changed by a dropped character lost a residue over 255 characters.
  - Carriage returns are written as `&#13;`, so XML parsers keep them.

## [0.3.0] - 2026-10-09

### Added

- `streamlined-gantt/mobile` and the script-tag add-on `mobile.iife.min.js` (ADR-0011):
  - below 600 px of width (a phone held upright) a readable summary replaces the chart: the
    programme's dates, an "Open the chart" button, and each task's dates with a mini bar; no
    inner scroll, and tapping a task opens the chart at it;
  - full screen on every screen size, from a Full screen button (in the built-in toolbar, else
    the chart's corner), the `F` key or `gantt.enterFullscreen()` / `exitFullscreen()` /
    `toggleFullscreen()` / `isFullscreen`: the Fullscreen API on the chart's stage element
    where it exists (with a landscape lock on touch screens), a full-viewport modal dialog on
    iPhone; focus kept inside, Escape returns; the chart fits the width and rows fit the height
    (24 to 44 px); a rail with close, zoom in, zoom out and fit; pinch to zoom;
  - `mobileView()`, `installMobile()`, the `mobile` option and the element's `mobile` attribute;
  - `layout-change` and `fullscreen-change` events;
  - tokens `--sg-cta-bg`, `--sg-cta-fg`, `--sg-cta-radius`, `--sg-preview-track`,
    `--sg-preview-font-size`, `--sg-rail-bg` and `--sg-touch-target`.
- `Gantt.extensions`, functions called with every new chart (for add-ons).
- An iPhone 15 (WebKit) Playwright project alongside Pixel 7 and iPad.

### Changed

- Touch targets: on touch screens a bar's move target is the full row height and at least 44 px
  wide, and resize handles are 32 px (were 24) and reach outwards on short bars.
- The built-in editor is a full-width bottom sheet below 600 px; on touch screens its inputs and
  buttons are at least 44 px tall with 16 px text (no iOS zoom on focus).
- The built-in toolbar folds everything after Today behind a "More" button when narrower than
  560 px.

## [0.2.0] - 2026-10-09

### Added

- `layout: "timeline"` (and the `layout` element attribute): no grid on the left, the timeline
  takes the full width and task and milestone names are drawn as bar labels. A visually hidden
  treegrid keeps the keyboard model and screen-reader names; the focused bar is outlined
  (ADR-0010).
- `fit: "width"` (and the `fit` attribute), `minDayWidth` and `setFit()`: the whole programme
  fits the width, refitted on resize and after edits, never during a drag.
- `TimeScale` `lead` and `trail` options for an exact range, and `zoomForDayWidth()`.

### Fixed

- The chart opened weeks (two months at month zoom) before the first task when the timeline
  was too short to scroll. The scale now starts one or two days before the first task.
- Bar labels near the right edge are drawn before the bar, or shortened with an ellipsis,
  instead of being clipped.
- The editor dialog stays centred when the host's CSS reset (Tailwind's preflight) zeroes
  `dialog` margins.

## [0.1.0] - 2026-10-09

### Added

- DOM-free engine (`streamlined-gantt/engine`): day-number date arithmetic, working-day
  calendars with holidays as data, CPM scheduling (FS/SS/FF/SF with lag and lead, SNET/FNLT,
  progress and data date, propagate/tight/off modes), total/free/negative float, programme
  validation with JSON Pointer paths, custom fields with computed values and roll-ups,
  `projectSummary()` with payment schedule and time-phased series, health check, CSV export,
  money and date formatting.
- JSON Schema for the v1 data format (`schema/programme.v1.json`).
- Theming (ADR-0009):
  - every visual value is a `--sg-*` token in `@layer streamlined-gantt`, with light and dark
    palettes and DaisyUI fallbacks;
  - `options.theme`, `setTheme()`, `setCategories()`, `refreshTheme()`, and
    `colorScheme` / `color-scheme`;
  - per-item colour: `task.category` and `categoryOf`, task and link `style.color`,
    `taskClass` / `taskStyle` callbacks, contrast-safe inside labels (`barLabels: "inside"`);
  - geometry tokens (row and bar height, radius);
  - print and export resolve the theme;
  - a theme playground example;
  - CI tests that fail on any raw colour literal or undocumented token.
- MS Project XML (MSPDI) import and export with a lossless round trip
  (`streamlined-gantt/io/mspdi`, ADR-0008).
- Optional entries `streamlined-gantt/io/csv` (`exportCSV`), `streamlined-gantt/health`
  (`check`), `streamlined-gantt/toolbar` (`buildToolbar`) and `streamlined-gantt/editor`
  (`builtinEditor`). The script-tag build includes the toolbar and the editor.
- Repository scaffolding: Apache-2.0 licence, NOTICE, CLA (draft), contribution guide, code of
  conduct, security policy, CI, build pipeline with licence banners and size budgets.
