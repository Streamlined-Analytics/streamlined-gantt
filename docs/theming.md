# Theming

Every colour, radius, stroke width and font size in streamlined-gantt is a CSS custom property
(a _token_) named `--sg-*`. There are no hard-coded visual values: a CI test fails if a raw colour
appears anywhere but the token block. You can theme a chart with CSS, with JavaScript, or from
the data itself (per task, per link, per category).

- [How the styles are layered](#how-the-styles-are-layered-and-why-your-css-wins)
- [Matching a design system](#matching-a-design-system) (DaisyUI, Tailwind, plain CSS)
- [Dark mode](#dark-mode)
- [Colour from data](#colour-from-data) (categories, task and link colours, callbacks)
- [JavaScript API](#javascript-api)
- [Token reference](#token-reference)

There is a live theme playground at `examples/theme-playground.html`.

## How the styles are layered, and why your CSS wins

All library styles are inside one cascade layer, `@layer streamlined-gantt`. **Unlayered CSS
always beats layered CSS, whatever the specificity.** So your stylesheet wins without
`!important`:

```css
/* your site's CSS, not in a layer */
.sg-root {
  --sg-bar: #0f766e;
}
.sg-bar-label {
  font-weight: 600;
}
```

If your own CSS uses layers, declare the order once, with ours first:

```css
@layer streamlined-gantt, base, components, utilities;
```

The precedence, lowest to highest:

1. The library's defaults (`@layer streamlined-gantt`).
2. Your CSS (unlayered, or in a later layer).
3. `options.theme` / `gantt.setTheme()`, which are inline custom properties on the chart root.
4. Per-item colours from data (`task.category`, `task.style.color`, `taskStyle()`), which are
   inline on the task's SVG group.

Critical-path colouring deliberately beats per-item colours while the critical path is shown,
because hiding it would hide the critical path. Turn it off with `setCriticalPathVisible(false)`
or `showCriticalPath: false`.

## Matching a design system

### DaisyUI and Tailwind

The colour tokens fall back to DaisyUI 5's variables. On a DaisyUI page the chart follows the
active theme with no configuration, including theme switches, because they are plain CSS
variables:

| streamlined-gantt                  | DaisyUI variable                           |
| ---------------------------------- | ------------------------------------------ |
| `--sg-bg`, `--sg-fg`               | `--color-base-100`, `--color-base-content` |
| `--sg-header-bg`, `--sg-grid-line` | `--color-base-200`, `--color-base-300`     |
| `--sg-bar`, `--sg-focus`           | `--color-primary`                          |
| `--sg-bar-critical`, `--sg-today`  | `--color-error`                            |
| `--sg-payment`, `--sg-delay`       | `--color-warning`                          |
| `--sg-access`, `--sg-data-date`    | `--color-info`                             |
| `--sg-need-by`                     | `--color-accent`                           |
| `--sg-key-date`                    | `--color-secondary`                        |
| `--sg-completion`                  | `--color-success`                          |

With Tailwind 4 (or any other system), map your own variables once:

```css
.sg-root {
  --sg-bar: var(--color-teal-700);
  --sg-bar-critical: var(--color-rose-600);
  --sg-font: var(--font-sans);
  --sg-radius: var(--radius-md);
}
```

### A plain-CSS brand

```css
.sg-root {
  --sg-palette-primary: #6d28d9; /* bars, focus rings, primary buttons */
  --sg-palette-error: #be123c; /* critical path, today line */
  --sg-font: "Inter", system-ui, sans-serif;
  --sg-label-font: "Inter", system-ui, sans-serif;
  --sg-radius: 2px;
  --sg-bar-radius: 0px;
  --sg-row-alt: #faf5ff;
  --sg-header-bg: #ede9fe;
}
```

Setting the `--sg-palette-*` tokens re-colours everything derived from them (selection, progress,
link colour mixes) in one go. Set a specific token, such as `--sg-bar`, to change just one
thing.

## Dark mode

The chart has a light and a dark palette.

- **It follows the operating system** (`prefers-color-scheme`) by default.
- **An ancestor with `data-theme="dark"` or `data-theme="light"`** overrides the system, which is
  how DaisyUI's theme switcher works. With any other DaisyUI theme name, the chart uses that
  theme's colours directly.
- **`colorScheme: "light" | "dark"`** (or the `color-scheme` attribute on `<streamlined-gantt>`)
  forces one palette.

If your site has no dark mode, set `colorScheme: "light"` (or `data-theme="light"` on `<html>`),
so a user whose system is dark does not get a dark chart on a light page.

The dark palette changes only the `--sg-palette-*` tokens and the default bar text colour.
Overrides you set (with CSS, or with `setTheme`) apply in both schemes; scope them with your own
`[data-theme]` selector when they should differ.

## Colour from data

### Categories

Colour bars by trade, phase or subcontractor. Give tasks a `category`, then map each category to
a colour:

```js
const gantt = new Gantt(host, {
  data,
  categories: {
    roofing: "#c2410c",
    scaffold: { color: "#334155", text: "#f8fafc" },
    "m-e": "#0369a1",
  },
});
```

Each category becomes the tokens `--sg-category-<key>` and `--sg-category-<key>-text`, so CSS
can set them too:

```css
.sg-root {
  --sg-category-roofing: #c2410c;
}
```

To colour by something other than `task.category`, use `categoryOf`:

```js
new Gantt(host, { data, categoryOf: (task) => task.trade });
```

Keys are lower-cased, with runs of other characters turned into `-`. So "Roofing & leadwork"
becomes `roofing-leadwork`. Each task's group also gets the class `sg-category-<key>`.

### One task or link

```json
{ "id": "t5", "name": "Membrane", "style": { "color": "#15803d", "textColor": "#ffffff" } }
{ "id": "l3", "from": "t2", "to": "t3", "style": { "color": "#94a3b8" } }
```

Links accept `category` too. A link's arrowhead takes the link's colour.

### Callbacks

```js
new Gantt(host, {
  data,
  taskClass: (task) => (task.fields?.margin < 0 ? "loss-making" : null),
  taskStyle: (task) => (task.locked ? { "--sg-task-color": "#64748b" } : null),
});
```

`taskClass` adds classes to the task's SVG group (`<g class="sg-task …">`), for your own CSS.
`taskStyle` returns inline styles or tokens for that group. Setting `--sg-task-color` there
recolours the bar, milestone or flag. Precedence, lowest to highest: category, then
`style.color`, then `taskClass`, then `taskStyle`.

### Readable text on custom colours

Labels placed inside bars (`barLabels: "inside"`) use `--sg-task-text`. For a hex colour from a
category or `style.color`, the chart picks dark or light text (`--sg-text-on-light` or
`--sg-text-on-dark`), whichever has the higher WCAG contrast. For other colour syntaxes, set
`textColor` (or the category's `text`), or `--sg-bar-text` for the default.

## JavaScript API

```js
const gantt = new Gantt(host, {
  data,
  theme: { bar: "#0f766e", barCritical: "#be123c", radius: "2px", barRadius: "0px" },
  colorScheme: "auto",
});

gantt.setTheme({ bar: "#7c3aed", rowAlt: "#f5f3ff" }); // merge
gantt.setTheme({ bar: null }); // remove an override; the CSS value applies again
gantt.setCategories({ roofing: "#c2410c" });
gantt.refreshTheme(); // after changing geometry tokens with your own CSS
```

Theme keys can be camelCase (`barCritical`), kebab-case (`bar-critical`) or full token names
(`--sg-bar-critical`).

Colours update live, because they are CSS. The geometry tokens (`--sg-row-height`,
`--sg-bar-height`, `--sg-summary-height`, `--sg-milestone-size`, `--sg-bar-radius`) are read when
the chart is created, by `setTheme`, and by `refreshTheme()`.

Print, SVG and PNG export (`streamlined-gantt/print`) resolve the tokens and per-item colours to
literal colours, so exports match the screen theme, dark included. For paper, you may prefer to
print from a light theme.

## Token reference

Defaults are the light palette. "Read by JS" tokens are lengths in `px`.

### Palette

These are the base colours. When DaisyUI variables are present, DaisyUI wins.

| Token                          | Default                    | Affects                                                        |
| ------------------------------ | -------------------------- | -------------------------------------------------------------- |
| `--sg-palette-bg`              | `#ffffff` (dark `#111827`) | chart background                                               |
| `--sg-palette-fg`              | `#1f2937` (dark `#e5e7eb`) | text, and mixes for muted, summary, milestone and link colours |
| `--sg-palette-line`            | `#e2e5ea`                  | grid lines, borders                                            |
| `--sg-palette-header`          | `#f4f5f7`                  | header backgrounds                                             |
| `--sg-palette-primary`         | `#2563eb`                  | bars, focus, primary buttons                                   |
| `--sg-palette-primary-content` | `#ffffff`                  | text on primary buttons                                        |
| `--sg-palette-secondary`       | `#9333ea`                  | key-date markers                                               |
| `--sg-palette-accent`          | `#7c3aed`                  | need-by flags                                                  |
| `--sg-palette-info`            | `#0e7490`                  | access flags, data-date line                                   |
| `--sg-palette-success`         | `#15803d`                  | completion line, valid link draft                              |
| `--sg-palette-warning`         | `#d97706`                  | payment milestones, delay bands, holidays                      |
| `--sg-palette-error`           | `#dc2626`                  | critical path, today line, errors                              |
| `--sg-palette-error-content`   | `#ffffff`                  | text on danger buttons                                         |
| `--sg-shade`                   | `#000000`                  | mixed in to darken progress and strokes                        |
| `--sg-text-on-dark`            | `#ffffff`                  | text chosen for dark custom colours                            |
| `--sg-text-on-light`           | `#111827`                  | text chosen for light custom colours                           |

### Surfaces and text

| Token                 | Default                           | Affects                             |
| --------------------- | --------------------------------- | ----------------------------------- |
| `--sg-bg`             | `--color-base-100` or palette     | chart, grid and control backgrounds |
| `--sg-fg`             | `--color-base-content` or palette | text                                |
| `--sg-muted`          | `--sg-fg` 78%                     | secondary text                      |
| `--sg-grid-line`      | `--color-base-300` or palette     | grid lines and borders              |
| `--sg-header-bg`      | `--color-base-200` or palette     | toolbar background                  |
| `--sg-header-fg`      | `--sg-fg`                         | header and toolbar text             |
| `--sg-grid-header-bg` | `--sg-header-bg`                  | grid column headers                 |
| `--sg-scale-bg`       | `--sg-header-bg`                  | timeline scale                      |
| `--sg-row-alt`        | `transparent`                     | every other grid row                |
| `--sg-row-hover`      | `--sg-fg` 4%                      | grid row under the pointer          |
| `--sg-selection`      | `--sg-bar` 13%                    | selected rows, active menu items    |
| `--sg-focus`          | primary                           | focus rings, selected bars          |
| `--sg-invalid`        | `--sg-bar-critical`               | invalid cells and fields            |
| `--sg-danger`         | `--sg-bar-critical`               | destructive menu items              |

### Bars, milestones and links

| Token                        | Default                              | Affects                        |
| ---------------------------- | ------------------------------------ | ------------------------------ |
| `--sg-bar`                   | primary                              | task bars                      |
| `--sg-bar-progress`          | `--sg-bar` darkened                  | progress fill                  |
| `--sg-bar-critical`          | error                                | critical bars, milestones      |
| `--sg-bar-critical-stroke`   | critical darkened                    | critical bar outline           |
| `--sg-bar-critical-progress` | critical darkened                    | progress on critical bars      |
| `--sg-progress-overlay`      | white 28% (dark: black 28%)          | critical-bar stripes           |
| `--sg-bar-text`              | `--sg-text-on-dark` (dark: on-light) | labels inside bars             |
| `--sg-bar-text-on-critical`  | as `--sg-bar-text`                   | labels inside critical bars    |
| `--sg-bar-label`             | `--sg-fg`                            | labels beside bars             |
| `--sg-summary`               | `--sg-fg` 80%                        | summary brackets               |
| `--sg-milestone`             | `--sg-fg` 85%                        | milestones                     |
| `--sg-payment`               | warning                              | payment milestones             |
| `--sg-payment-stroke`        | payment darkened                     | payment outline                |
| `--sg-access`                | info                                 | access-date flags              |
| `--sg-need-by`               | accent                               | need-by flags                  |
| `--sg-reference`             | `--sg-fg` 40%                        | reference (others') activities |
| `--sg-baseline`              | `--sg-fg` 35%                        | baseline bars                  |
| `--sg-link`                  | `--sg-fg` 60%                        | dependency lines and arrows    |
| `--sg-link-critical`         | `--sg-bar-critical`                  | critical links                 |
| `--sg-link-selected`         | `--sg-focus`                         | the selected link              |
| `--sg-link-valid`            | `--sg-completion`                    | link being drawn, when valid   |

### Calendar and markers

| Token             | Default       | Affects                     |
| ----------------- | ------------- | --------------------------- |
| `--sg-weekend`    | grid line 55% | non-working days            |
| `--sg-holiday`    | payment 16%   | bank holidays and shutdowns |
| `--sg-lookahead`  | data date 8%  | the lookahead window        |
| `--sg-today`      | error         | today line and flag         |
| `--sg-data-date`  | info          | data-date line and flag     |
| `--sg-completion` | success       | contract completion line    |
| `--sg-key-date`   | secondary     | key-date markers            |
| `--sg-delay`      | warning       | delay-event bands           |

### Controls and overlays

| Token                    | Default                | Affects                |
| ------------------------ | ---------------------- | ---------------------- |
| `--sg-control-border`    | `--sg-fg` 30%          | inputs and buttons     |
| `--sg-button-bg`         | `--sg-bg`              | buttons                |
| `--sg-button-fg`         | `--sg-fg`              | buttons                |
| `--sg-button-primary-bg` | `--sg-focus`           | primary buttons        |
| `--sg-button-primary-fg` | primary content        | primary buttons        |
| `--sg-button-danger-bg`  | `--sg-bar-critical`    | delete buttons         |
| `--sg-button-danger-fg`  | error content          | delete buttons         |
| `--sg-tooltip-bg`        | `--sg-fg`              | tooltip                |
| `--sg-tooltip-fg`        | `--sg-bg`              | tooltip                |
| `--sg-menu-bg`           | `--sg-bg`              | context menu           |
| `--sg-menu-fg`           | `--sg-fg`              | context menu           |
| `--sg-modal-bg`          | `--sg-bg`              | dialogs                |
| `--sg-modal-fg`          | `--sg-fg`              | dialogs                |
| `--sg-backdrop`          | black 35%              | behind dialogs         |
| `--sg-shadow`            | `0 6px 20px` black 18% | menu, tooltip, dialogs |

### Phone (`streamlined-gantt/mobile`)

The phone summary is its own `.sg-root` element next to the chart, so a host rule such as
`[data-gantt-host] .sg-root { … }` styles the chart, the summary and the full-screen view alike.

| Token                    | Default                  | Affects                                                 |
| ------------------------ | ------------------------ | ------------------------------------------------------- |
| `--sg-cta-bg`            | `--sg-button-primary-bg` | the summary's "Open the chart" button                   |
| `--sg-cta-fg`            | `--sg-button-primary-fg` | its text                                                |
| `--sg-cta-radius`        | `--sg-radius`            | its corners (`999px` for a pill)                        |
| `--sg-preview-track`     | `--sg-fg` 8%             | the track behind each mini bar                          |
| `--sg-preview-font-size` | `15px`                   | summary text                                            |
| `--sg-rail-bg`           | `--sg-header-bg`         | the full-screen control rail                            |
| `--sg-touch-target`      | `44px`                   | rail buttons, summary rows, the call to action on touch |

### Type

| Token                    | Default     | Affects                  |
| ------------------------ | ----------- | ------------------------ |
| `--sg-font`              | `inherit`   | everything               |
| `--sg-label-font`        | `--sg-font` | bar labels               |
| `--sg-font-size`         | `13px`      | grid and body            |
| `--sg-font-size-small`   | `11px`      | scale ticks, bar labels  |
| `--sg-font-size-tiny`    | `10px`      | marker flags, type icons |
| `--sg-tooltip-font-size` | `12px`      | tooltip, form errors     |
| `--sg-modal-font-size`   | `14px`      | dialogs                  |
| `--sg-modal-title-size`  | `17px`      | dialog titles            |
| `--sg-line-height`       | `1.3`       | body text                |

### Shape and size

| Token                            | Default              | Affects                                           |
| -------------------------------- | -------------------- | ------------------------------------------------- |
| `--sg-radius`                    | `6px`                | chart corners, buttons, inputs, tooltip           |
| `--sg-radius-small`              | `3px`                | marker flags, cell editor                         |
| `--sg-menu-radius`               | `8px`                | context menu                                      |
| `--sg-modal-radius`              | `10px`               | dialogs                                           |
| `--sg-bar-radius`                | `3px`                | bar corners (read by JS)                          |
| `--sg-border-width`              | `1px`                | borders and grid lines                            |
| `--sg-focus-width`               | `2px`                | focus rings                                       |
| `--sg-selected-width`            | `2px`                | selected bar outline                              |
| `--sg-link-width`                | `1.25px`             | dependency lines                                  |
| `--sg-critical-link-width`       | `1.25px`             | critical links                                    |
| `--sg-selected-link-width`       | `2.5px`              | the selected link                                 |
| `--sg-critical-bar-stroke-width` | `1.5px`              | critical bar outline                              |
| `--sg-marker-width`              | `1.5px`              | marker lines, flags, link handles                 |
| `--sg-completion-width`          | `2px`                | completion line                                   |
| `--sg-cell-padding`              | `6px`                | grid cell padding                                 |
| `--sg-indent`                    | `16px`               | outline indent per level                          |
| `--sg-header-height`             | `48px`               | header (66px with marker flags)                   |
| `--sg-height`                    | `480px`              | chart height (`options.height`)                   |
| `--sg-row-height`                | 32px (40px on touch) | row height (read by JS; `options.rowHeight` wins) |
| `--sg-bar-height`                | 56% of the row       | bar height (read by JS)                           |
| `--sg-summary-height`            | 30% of the row       | summary bracket height (read by JS)               |
| `--sg-milestone-size`            | 50% of the row       | milestone and flag size (read by JS)              |

### Per item

These are set from data, options or your own CSS.

| Token                      | Default             | Affects                                     |
| -------------------------- | ------------------- | ------------------------------------------- |
| `--sg-category-<key>`      | unset               | bars, milestones and links in that category |
| `--sg-category-<key>-text` | chosen for contrast | inside labels in that category              |
| `--sg-task-color`          | unset               | one task (`style.color`, `taskStyle`)       |
| `--sg-task-text`           | chosen for contrast | inside label of one task                    |
| `--sg-link-color`          | unset               | one link (`style.color`, `category`)        |
