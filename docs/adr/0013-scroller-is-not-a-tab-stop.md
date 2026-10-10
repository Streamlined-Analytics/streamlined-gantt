# 0013. The chart's scroller is never a tab stop

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** ui/gantt, keyboard accessibility
- **Builds on:** ADR-0002 (DOM treegrid with a roving tabindex, so the chart is a single tab stop)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

The first nightly run (2026-10-10), which was also the first time Firefox ran the browser
tests, failed `tests/e2e/keyboard.spec.js`. One Tab from the page did not land on the grid's
roving cell. A probe of the tab order showed Firefox stopping on `.sg-scroller` first, and only
reaching the grid cell on a second Tab. Chromium and WebKit go straight to the cell.

Firefox makes every scrollable element keyboard-focusable, so that keyboard users can scroll
it, even when the element has focusable descendants. Chromium does the same only for scrollers
with no focusable content. Our scroller always holds the roving cell, so only Firefox added the
extra stop. That broke ADR-0002's promise of a single tab stop, and the stop did nothing useful:
the grid's own arrow-key navigation already scrolls the chart.

The existing a11y check (`exactly one tab stop`) counted `[tabindex="0"]` elements. It could not
see a tab stop that the browser adds implicitly.

## What did we try?

### Option 1: accept it as Firefox behaviour ❌ rejected

A redundant tab stop that announces as an unnamed group is a WCAG 2.4.3 (focus order) annoyance
in the browser many screen-reader users choose. It is cheap to remove.

### Option 2: `tabindex="-1"` on the scroller ✅ chosen

This takes the scroller out of the sequential focus order in every browser, while it can still
be focused from script. It leaves pointer, wheel and touch scrolling alone. Keyboard scrolling
still works through the grid's arrow keys, Page Up/Down, Home and End.

## What did we land on, and why?

Option 2, a one-attribute change in `Gantt.buildDom`. We probed for a trap after the cell:
Firefox under Playwright keeps `activeElement` on the cell when Tab leaves the document. With a
focusable element after the chart, Tab moves on to it, so this is not a keyboard trap.

The `exactly one tab stop` test now walks the real tab order: one Tab lands on the roving cell,
and the next Tab leaves the chart for a button placed after it. This runs in Chromium and WebKit
on every PR, and in Firefox nightly.

## What does this cost us?

- Nothing at runtime. Hosts that relied on tabbing to the scroller (there is no documented
  reason to) lose that stop.
