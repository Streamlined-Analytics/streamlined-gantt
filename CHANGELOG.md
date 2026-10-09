# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The JSON data format has its own version
(`"schema": "streamlined-gantt/1"`).

## [Unreleased]

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
  (`check`) and `streamlined-gantt/toolbar` (`buildToolbar`).
- Repository scaffolding: Apache-2.0 licence, NOTICE, CLA (draft), contribution guide, code of
  conduct, security policy, CI, build pipeline with licence banners and size budgets.
