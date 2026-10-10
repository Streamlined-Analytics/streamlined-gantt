# streamlined-gantt

A framework-free JavaScript Gantt chart and scheduling library by
[Streamlined Analytics Ltd](https://streamlinedanalytics.co.uk).

> **Status:** pre-release (0.x), private repository. Not yet published to npm.

## Features

**Scheduling**

- Critical path scheduling: FS, SS, FF and SF links with lag and lead.
- Total, free and **negative** float.
- Working-day calendars, with bank holidays supplied as data.
- Constraints, progress and a data date.
- Three modes: push successors later, also pull them back, or report only.

**Tracking**

- Payment milestones with values, and a payment schedule.
- Custom fields (cost, quantity, computed margin) with roll-ups.
- Baselines, delay bands, a lookahead filter, and deadline markers.
- A schedule health check.

**Editing**

- Drag to move or resize bars, and to draw links.
- Inline cell editing, a task dialog and a context menu.
- Undo and redo, with a full keyboard alternative to every drag.

**Viewing**

- Day, week, month and quarter zoom, and fit to width.
- A grid-and-timeline layout, or a timeline-only layout.
- Collapsible WBS outline.
- Smooth with 1,000 tasks and 1,500 links (virtualised rows).

**Phones and touch**

- A readable summary in place of the chart on phones.
- A full-screen chart with pinch zoom.
- Touch-sized handles.

**Integrating with your backend**

- Typed events that are also DOM `CustomEvent`s.
- Cancelable `before-*` events for server approval (`event.waitUntil`).
- One `change` event per edit.
- `applyPatch()` for corrections the server pushes back.
- A `<streamlined-gantt>` element that works with htmx out of the box.

**Import and export**

- MS Project XML (MSPDI) import and export, with a lossless round trip.
- CSV.
- A3/A4 print, SVG and PNG.

**Look and feel**

- Every visual value is a `--sg-*` CSS token.
- Follows DaisyUI themes and dark mode.
- Colour bars by category from your data.

**Built to be safe to adopt**

- Plain ES2022 JavaScript, **zero runtime dependencies**, no framework.
- Core bundle under 45 KB gzip; everything else is an optional import.
- Built for WCAG 2.2 AA: a single tab stop, a screen-reader treegrid, and axe tests in CI.
- Tested in Chromium, Firefox and WebKit, including mobile devices.
- Apache-2.0 licensed.

## Quick start

### ES module

```html
<link rel="stylesheet" href="/static/streamlined-gantt/streamlined-gantt.css" />
<div id="programme"></div>
<script type="module">
  import { Gantt } from "/static/streamlined-gantt/streamlined-gantt.js";
  import { builtinEditor } from "/static/streamlined-gantt/editor.js"; // optional task dialog

  const data = await (await fetch("/jobs/42/programme.json")).json();
  const gantt = new Gantt(document.getElementById("programme"), {
    data,
    zoom: "week",
    editor: builtinEditor,
    fields: [
      { key: "cost", label: "Cost", type: "currency", rollup: "sum", column: true },
      { key: "charge", label: "Charge", type: "currency", rollup: "sum", column: true },
    ],
  });

  // One event per committed edit (a drag and its cascade, an editor save, undo…).
  gantt.on("change", (event) => console.log(event.cause, event.changes));
</script>
```

### Script tag and htmx

```html
<link rel="stylesheet" href="/static/streamlined-gantt/streamlined-gantt.css" />
<script src="/static/streamlined-gantt/streamlined-gantt.iife.min.js"></script>

<streamlined-gantt src="/jobs/42/programme.json" zoom="week"></streamlined-gantt>
```

The element initialises when htmx swaps it in and destroys itself when it is swapped out. No
`htmx:afterSwap` hook is needed. Events bubble as DOM `CustomEvent`s named `gantt:<event>`:

```html
<streamlined-gantt
  id="job"
  src="/jobs/42/programme.json"
  listen-patch
  hx-post="/jobs/42/programme/changes/"
  hx-trigger="gantt:change[detail.source=='local']"
  hx-vals='js:{changes: JSON.stringify(event.detail.changes), target: "#job"}'
  hx-swap="none"
></streamlined-gantt>
```

To revert or correct an edit, the server replies with
`HX-Trigger: {"gantt:patch": {"target": "#job", "changes": {"tasks": {"update": [...]}}}}`.
See `examples/htmx-save-back.html` and [docs/integration.md](docs/integration.md).

### Server approval

```js
gantt.on("before-task-update", (event) => {
  event.waitUntil(
    fetch(`/jobs/42/tasks/${event.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
      body: JSON.stringify({ task: event.new }),
    }).then((response) => {
      if (response.status === 204) return undefined; // approved as made
      if (response.status === 409) return false; // rejected: the edit is undone
      return response.json(); // a changeset corrects the edit
    }),
  );
});
```

Dates are ISO `YYYY-MM-DD` calendar dates. **`finish` is inclusive** (the last working day) and
`duration` counts working days. Money is integer pence. See `docs/` for the data format, the
event catalogue and the integration guides.

### Theming

Every colour, radius, stroke and font size is a `--sg-*` CSS custom property inside
`@layer streamlined-gantt`, so your own CSS wins without `!important`. The chart follows DaisyUI
themes and dark mode automatically, and can be coloured from data:

```css
.sg-root {
  --sg-bar: #0f766e;
  --sg-font: "Inter", sans-serif;
  --sg-bar-radius: 0px;
}
```

```js
new Gantt(host, {
  data,
  categories: { design: "#c2410c", testing: "#334155" }, // task.category: "design"
  theme: { barCritical: "#be123c" },
});
gantt.setTheme({ bar: "#7c3aed" });
```

See [docs/theming.md](docs/theming.md) for every token, and `examples/theme-playground.html` to try
them.

### Optional entries

The core bundle stays under 45 KB gzip. Everything else is a separate import:

| Import                       | What                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| `streamlined-gantt/engine`   | Scheduling and calendars without the DOM (Node, workers)        |
| `streamlined-gantt/print`    | A3/A4 print, SVG and PNG export                                 |
| `streamlined-gantt/io/mspdi` | MS Project XML import and export                                |
| `streamlined-gantt/io/csv`   | `exportCSV(gantt)`                                              |
| `streamlined-gantt/health`   | `check(gantt)`: schedule health check                           |
| `streamlined-gantt/toolbar`  | The built-in toolbar (`toolbar: buildToolbar`)                  |
| `streamlined-gantt/editor`   | The built-in task dialog (`editor: builtinEditor`)              |
| `streamlined-gantt/mobile`   | Full screen on every size, and the phone summary (`mobileView`) |

The script-tag build (`streamlined-gantt.iife.min.js`) includes the toolbar and the editor dialog,
so `toolbar: true` and the default `editor: "builtin"` work there and on `<streamlined-gantt>`.
The phone experience is a separate script, `mobile.iife.min.js`, loaded after it; then
`mobile: true` (or the element's `mobile` attribute) turns it on. See
[docs/integration.md](docs/integration.md#phones).

## Licence and attribution

streamlined-gantt is licensed under the [Apache License, Version 2.0](LICENSE).

- You may use, modify and distribute it, including in commercial and closed-source products.
- If you **redistribute** it, modified or not, keep the `LICENSE` and [`NOTICE`](NOTICE) files and
  the `/*! streamlined-gantt … */` banner at the top of each bundle (Apache-2.0 §4). Terser,
  esbuild and most other minifiers keep `/*!` comments by default; please do not strip them.
- Mark any files you have modified (§4(b)).
- The **Streamlined Analytics name and logo are not licensed** to you (Apache-2.0 §6). Do not use
  them to suggest endorsement, and do not name a fork "Streamlined Analytics …".
- The library never injects visible branding into the chart. If you would like to credit us, an
  optional, entirely voluntary badge is welcome:

  ```html
  <a href="https://github.com/Streamlined-Analytics/streamlined-gantt">
    Built with streamlined-gantt by Streamlined Analytics
  </a>
  ```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are taken under a Contributor License
Agreement ([CLA.md](CLA.md)), which is currently a draft awaiting legal review. Please read the
[code of conduct](CODE_OF_CONDUCT.md) and report vulnerabilities as described in
[SECURITY.md](SECURITY.md).

Commercial support and bespoke integration are available from
[Streamlined Analytics](https://streamlinedanalytics.co.uk).
