# 0010. A full-width timeline layout, fit-to-width zoom and an exact scale start

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** rendering, layout, accessibility, bundle size
- **Builds on:** ADR-0002 (DOM treegrid and SVG timeline)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

The first consumer, the construction Gantt page on the Streamlined Analytics website, already
shows its own live task table (name, days, cost, charge, margin). On that page the library's
left-hand grid repeated the table and took about 470 px of a 1,100 px card, so the bars got less
than 60% of the width and the programme needed horizontal scrolling. Ben asked for:

1. no grid on the left: the timeline takes the whole width, with task names on the bars;
2. a zoom that fits the whole programme into the width, refitted when the page resizes;
3. a fix for the initial view, which opened weeks (at month zoom, two months) before the first
   task.

The core bundle had 1.5 KB of its 45 KB gzip budget left.

## What did we try?

### Attempt 1: remove the treegrid in the timeline layout and make the SVG focusable ❌ rejected

The treegrid carries the whole accessibility model of ADR-0002: row positions under
virtualisation, the spoken description of each task, the roving tab stop, and every keyboard
command (selection, Alt + arrows, Ctrl + Enter, undo). Rebuilding that on SVG elements would
duplicate the keyboard controller and grow the core by several KB, and SVG focus handling is
uneven across browsers.

### Attempt 2: keep the treegrid, visually hidden ✅ chosen

In `layout: "timeline"` the treegrid still renders, with just the name column, but is clipped to
1 px (`clip-path: inset(50%)`) and takes no layout space. Screen readers and the keyboard use it
exactly as before. To keep focus visible (WCAG 2.4.7), the focused task's bar gets a dashed
focus-colour outline while focus is inside the hidden grid (`:focus-visible`). Clicking a bar now
moves focus to its row, so the keyboard commands work straight after a click. Enter and F2 open
the task editor instead of an inline cell editor nobody could see. The context menu, when opened
from the keyboard, anchors to the bar.

Labels default to `barLabels: "inside"`: inside when the name fits, else after the bar, and
before the bar when "after" would run past the right edge. When neither side has room (a
phone-width chart), the label goes on the roomier side and is shortened with an ellipsis, so a
fitted programme never clips a label; the full name stays in the hidden treegrid.

### Fit to width: a fitted day width, frozen during a drag ✅ chosen

`fit: "width"` builds the scale from the first start to the last finish (and markers), plus a
2% margin on each side, with `dayWidth = available / days`. The header tiers come from the
nearest zoom level (`zoomForDayWidth`). The fitted scale is cached against the available width
and the date range, so a `ResizeObserver` render or a commit that changes the programme length
refits it, while a drag preview keeps the cached scale (bars do not jump under the pointer; it
refits after the drop). Below `minDayWidth` (4 px) the day width stops shrinking and the timeline
scrolls. In fit mode the timeline clips horizontal overflow, so link handles on the last bar
cannot add a scrollbar. `setZoom()` switches fitting off; `setFit()` switches it back on.

### The initial view: scroll to the first task ❌ not enough on its own

The old scale padded the start by 2 to 17 weeks (depending on the zoom) and rounded it back to a
week or month, then scrolled to the first task. When the timeline was narrower than the
viewport, which is common at month zoom, there was nothing to scroll, so the view opened at the
padded start. Fixing the scroll alone could not help that case.

### The initial view: an exact scale start ✅ chosen

`TimeScale` takes `lead` and `trail` (days). With them the range is exact: no rounding to whole
weeks or months, the first tick is a partial one. The interactive chart uses a lead of
`max(2, ceil(24 px / dayWidth))` days, so it always opens at, or one or two days before, the
first task. The trailing padding is unchanged, for drag room. When a drag pulls the start earlier
the scale grows to the left, and the chart shifts `scrollLeft` by the same amount so nothing moves
under the pointer. Print and export keep the rounded scale.

## What did we land on, and why?

- `layout: "grid" | "timeline"`, `fit: "width"`, `minDayWidth`, `setFit()`, and the `layout`
  and `fit` element attributes.
- An exact scale start for both layouts.
- Core 44.12 KB gzip (was 43.52), script-tag build 46.59 KB (was 46.01), CSS 4.02 KB (was 3.92).

We did not add a "grid below the timeline" option: hosts that want a table render their own,
as the website does.

## What does this cost us?

- The visual baselines changed: every chart now starts at the first task, with a partial first
  header tick.
- A sighted keyboard user sees the focused bar, not a focused row; tasks with no dates have no
  bar to outline.
- The label width is estimated (6.5 px per character), so a name close to the bar width may
  sit outside when it would just have fitted.
- About 600 bytes of the core budget; about 0.9 KB remains.
