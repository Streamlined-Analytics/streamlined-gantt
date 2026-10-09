# 0001. Build the Gantt library from scratch in plain JavaScript with zero runtime dependencies

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** architecture
- **Builds on:** none — first ADR for architecture
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

Streamlined Analytics builds bespoke tools for UK construction subcontractors and trades on
Django, htmx, hyperscript and Tailwind/DaisyUI. Those tools need an editable programme (Gantt)
view that understands working-day calendars, UK bank holidays, critical path, negative float,
baselines and stage-payment milestones, and that can be driven entirely from a backend through
events and JSON.

Fixed constraints: plain JavaScript at runtime (no React, Vue, Angular or Svelte), a permissive
licence we control, and a size that suits script-tag use on htmx pages.

## What did we try?

### Attempt 1 — DHTMLX Gantt Community 10 (MIT) ❌ failed in practice

The proof page (`gantt-proof/index.html`, 9 October 2026) rendered the flat-roof job with
DHTMLX. It looked like a proper programme, but the Community bundle stubs working-time
calendars, removes `addTaskLayer` (baselines) and keeps auto-scheduling, critical path and undo
in the paid PRO tier. Those are exactly the construction-critical features. It is also 180 KB
gzipped.

### Attempt 2 — Frappe Gantt 1.2 (MIT) ❌ failed in practice

Small (13.5 KB gzipped) and skips weekends and holidays, but it has no grid, no tree, no native
milestones, FS-only arrows without lag, no critical path and no baselines. Extending it would be
a fork.

### Attempt 3 — commercial libraries (Bryntum, DHTMLX PRO, Highcharts Gantt) ❌ rejected up front

Capable, but per-developer licences, client-specific licensing when clients own the IP, and no
control over the roadmap. They also cannot be offered to the market as our own open-source
product.

### Attempt 4 — write it from scratch ✅ chosen

A framework-free library whose scheduling engine is a pure module, with a DOM tree grid and an
SVG timeline.

## What did we land on, and why?

Write `streamlined-gantt` from scratch: ES2022 with JSDoc types, zero runtime dependencies, an
ESM build, an IIFE build that auto-registers `<streamlined-gantt>` for htmx pages, and a CSS
file in its own `@layer`. The engine (`src/engine/`) has no DOM imports so it can be unit- and
property-tested in Node and moved to a worker later.

The deciding reason: every free library deliberately omits the scheduling engine, and that
engine is the product. Owning it lets us ship the construction-specific features nobody offers
(payment milestones, access dates, lookahead, negative float) under our own licence.

## What does this cost us?

- We own every bug, especially date arithmetic. Mitigated by day-number arithmetic, property
  tests and multi-time-zone CI (see ADR-0003).
- Accessibility, print and performance work that libraries already did must be redone.
- Scope creep towards P6/Asta is a real risk; the non-goals list in CONTRIBUTING.md is the
  guard.
- Size must be watched: a 45 KB gzip core budget is enforced in CI.
