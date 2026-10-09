# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The JSON data format has its own version
(`"schema": "streamlined-gantt/1"`).

## [Unreleased]

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
- Bar labels near the right edge are drawn before the bar instead of being clipped.

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
