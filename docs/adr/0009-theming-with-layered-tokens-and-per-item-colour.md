# 0009. Theming: layered tokens, per-item colour and a JS theme API

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** theming, styling, bundle size
- **Builds on:** ADR-0002 (DOM treegrid and SVG timeline)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

The chart has to match any brand: ours, and those of the sites and SaaS products that embed it.
The first version had 29 `--sg-*` colour tokens with DaisyUI fallbacks, `task.style.color` and
`className`. But many visual values were still hard-coded:

- a white progress overlay;
- white button text;
- the modal backdrop and shadows;
- radii, stroke widths and font sizes;
- white in the print and PNG output.

There was also no way to colour by trade or subcontractor, no dark palette without DaisyUI, and
no way to theme from JavaScript.

The core bundle must also stay at 45 KB gzip or less (spec), and it had 50 bytes of headroom.

## What did we try?

### Attempt 1: CSS-only theming, with contrast computed by probing the DOM ❌ rejected for size

Every value became a token, and the text colour for custom bars was found by resolving any
colour (including `var()` and `color-mix()`) through a probe element and computing WCAG
luminance. It worked, but the probe-based resolver and the rest of the theming code took the
core from 44.95 KB to 46.55 KB.

### Attempt 2: keep theming, move rarely used features out of the core ✅ chosen

- **Contrast** is computed only for hex colours, which is how brand colours are given. Anything
  else uses the category's `-text` token or `--sg-bar-text`. The coordinator explicitly allowed
  "a token per category for text".
- **CSV export moved** to `streamlined-gantt/io/csv` (`exportCSV(gantt)`). The spec already
  lists `io/csv` as an optional sub-path.
- **The health check moved** to `streamlined-gantt/health` (`check(gantt)`). No UI uses it yet.
  A warnings panel can import it.
- **The built-in toolbar moved** to `streamlined-gantt/toolbar` (`toolbar: buildToolbar`). Most
  hosts render their own toolbar in their own design system. The script-tag build registers it,
  so `toolbar: true` still works there and on `<streamlined-gantt>`.

The core is now 44.80 KB.

### Attempt 3: lazy-load the built-in editor ❌ rejected

With esbuild code splitting, the eagerly loaded size fell by only about 0.7 KB, because shared
modules move to extra chunks. The core would also have become four files, which complicates CDN
and script-tag use.

## What did we land on, and why?

1. **One token block**, marked `tokens:start` / `tokens:end`, inside
   `@layer streamlined-gantt`. It is the only place a raw colour may appear. A unit test fails on:
   - any colour literal in CSS rules outside the block;
   - any colour literal in the UI, element or print JS;
   - any token the code uses that is not defined;
   - any token that is defined but not documented, or documented but not defined.
2. **Palette tokens** (`--sg-palette-*`) feed the semantic tokens. DaisyUI variables are
   preferred when present. A dark palette applies:
   - under `prefers-color-scheme: dark`, unless an ancestor has `data-theme="light"`;
   - under an ancestor `[data-theme="dark"]`;
   - with `colorScheme: "dark"`.
3. **The specificity model is the cascade layer.** Unlayered host CSS beats everything in the
   layer, so no `!important` is needed. `setTheme` writes inline custom properties on the root,
   and per-item colours write them on the task's SVG group.
4. **Per-item colour:**
   - `task.category` (or `categoryOf(task)`) maps to `--sg-category-<key>` and
     `--sg-category-<key>-text`;
   - `style.color` and `style.textColor` set a task's colours, and `style.color` a link's;
   - `taskClass(task)` and `taskStyle(task)` callbacks;
   - links with custom colours get matching arrowheads.

   The critical path still wins while it is shown.

5. **A JS API:** `options.theme`, `setTheme(partial)` (camelCase, kebab or full token names;
   `null` removes), `setCategories()`, `refreshTheme()`, and the
   `colorScheme`/`color-scheme` option and attribute.
6. **Geometry tokens** (`--sg-row-height`, `--sg-bar-height`, `--sg-summary-height`,
   `--sg-milestone-size`, `--sg-bar-radius`) are read into numbers on create, `setTheme` and
   `refreshTheme`, because layout maths needs them in JS. The renderer writes its own
   `--sg-row-px`, so the public token stays an input.
7. **Print and export** resolve tokens and per-item colours to literal colours, so standalone SVG,
   PNG and print match the screen.

Pinned by:

- `tests/unit/theme-tokens.test.js` (literals and token coverage);
- `tests/unit/theme.test.js` (helpers);
- `tests/dom/theme.test.js` (rendering, precedence, schemes, print);
- visual snapshots for the light, dark and brand themes;
- axe scans of the dark, brand and DaisyUI themes and of OS dark mode.

## What does this cost us?

- **Breaking API moves before 1.0:**
  - `gantt.exportCSV()` is now `exportCSV(gantt)` from `io/csv`;
  - `gantt.check()` is now `check(gantt)` from `health`;
  - ES module users pass `toolbar: buildToolbar`.
- **The core is near its budget** (44.80 of 45 KB). New core features will need something else
  to move out, or a decision to raise the budget.
- Automatic contrast covers hex colours only.
- Geometry tokens changed by CSS outside `setTheme` need `refreshTheme()` before they take
  effect. Colours never do.
- The dark palette follows the operating system by default. A site without a dark mode should
  set `colorScheme: "light"`.
