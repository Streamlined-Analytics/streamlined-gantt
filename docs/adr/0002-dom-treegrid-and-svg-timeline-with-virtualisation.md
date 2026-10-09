# 0002. Render a DOM treegrid and an SVG timeline, virtualised by row

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** rendering
- **Builds on:** ADR-0001 (architecture)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

The chart must be:

- accessible (WCAG 2.2 AA, with screen-reader row positions);
- themable through CSS (DaisyUI and Tailwind tokens, dark mode, print);
- exportable as SVG, PNG and PDF;
- able to draw dependency arrows, milestones and hatched bands;
- fast enough for 1,000 tasks and 1,500 links on an iPad.

The first consumer's headline is "drag the programme", so the rendering has to support smooth
pointer and touch editing.

## What did we try?

### Attempt 1 — canvas ❌ rejected up front

Fast, but canvas has no DOM for assistive technology, cannot be styled with CSS custom
properties, prints poorly and needs hand-written hit testing.

### Attempt 2 — all DOM / CSS grid ❌ rejected up front

Accessible and themable, but dependency arrows still need SVG, and exporting a DOM bar chart to
a standalone SVG means re-rendering it anyway.

### Attempt 3 — hybrid: DOM treegrid plus SVG timeline ✅ chosen

## What did we land on, and why?

- **Grid:** an ARIA `treegrid`. It uses `aria-rowcount` and `aria-rowindex` so virtualisation
  does not break the row position screen readers announce, `aria-level` and `aria-expanded` for
  the WBS tree, and a roving tabindex so the chart is a single tab stop. The SVG is
  `aria-hidden`; every fact on a bar is also available in its grid row (the tree cell has a full
  spoken description).
- **Timeline:** one SVG for the whole body, holding bars, milestones, links, markers, baselines
  and delay bands, all coloured through CSS custom properties that fall back to DaisyUI v5 and
  Tailwind v4 tokens. Critical bars carry a dashed outline and a pattern, so criticality never
  relies on colour alone (WCAG 1.4.1).
- **Layout:** one scroll container. The grid is `position: sticky; left: 0`, and both headers
  are `position: sticky; top: 0`, so vertical scrolling stays in sync without any JavaScript
  scroll mirroring.
- **Virtualisation:**
  - Only rows in the visible window plus 10 rows of overscan exist in the DOM.
  - Grid rows and SVG task groups are keyed by task id and rebuilt only when a content signature
    changes, so a one-row scroll creates one row.
  - The SVG spans the full body height, so task coordinates never change on scroll.
  - Links are drawn only when one end is in the window.
  - Non-working shading and header ticks are drawn for the visible range plus a 1,024 px chunk on
    either side.
- **Narrow screens:** below 720 px, the grid shows only the task name, at most 42% of the width,
  so the timeline stays usable on phones.

Measured on the 1,000-task / 1,500-link fixture in headless Chromium: about 9–12 ms for the
first render pass, and well under the 250 ms page-level budget.

## What does this cost us?

- An SVG as tall as the body (32,000 px for 1,000 rows) relies on browsers tiling large layers.
  Horizontal tiling for multi-year day-zoom programmes is on the v2 list.
- Touch-action on SVG shapes is unreliable, so touch drags use tap-to-select and a non-passive
  `touchstart` on the selected task's handles (see ADR-0004).
- Two rendering paths will exist once the print and export renderer lands; it reuses the same
  geometry and routing functions so they cannot drift.
