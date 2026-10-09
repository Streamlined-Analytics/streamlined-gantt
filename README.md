# streamlined-gantt

A framework-free JavaScript Gantt and construction programme library by
[Streamlined Analytics Ltd](https://streamlinedanalytics.co.uk).

- Plain ES2022 JavaScript, **zero runtime dependencies**, no framework.
- Working-day calendars with bank holidays supplied as data, FS/SS/FF/SF links with lag, critical
  path with total, free and **negative** float.
- Construction concepts as first-class data: stage-payment milestones with values, access dates,
  baselines, lookahead, delay bands and A3 print.
- An integration API built for backends: typed events mirrored as DOM `CustomEvent`s, cancelable
  `before-*` events with `event.waitUntil(promise)` for server approval, one `change` event per
  transaction, undo/redo and `applyPatch()`.

> **Status:** pre-release (0.x), private repository. Not yet published to npm.

## Quick start

### ES module

```html
<link rel="stylesheet" href="/static/streamlined-gantt/streamlined-gantt.css" />
<div id="programme"></div>
<script type="module">
  import { Gantt } from "/static/streamlined-gantt/streamlined-gantt.js";

  const data = await (await fetch("/jobs/42/programme.json")).json();
  const gantt = new Gantt(document.getElementById("programme"), {
    data,
    zoom: "week",
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
  src="/jobs/42/programme.json"
  hx-post="/jobs/42/programme/changes/"
  hx-trigger="gantt:change"
  hx-vals="js:{changes: JSON.stringify(event.detail.changes)}"
></streamlined-gantt>
```

### Server approval

```js
gantt.on("before-task-update", (event) => {
  event.waitUntil(
    fetch(`/jobs/42/tasks/${event.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
      body: JSON.stringify(event.changes),
    }).then((response) => (response.ok ? response.json() : false)), // a changeset corrects the edit
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
  categories: { roofing: "#c2410c", scaffold: "#334155" }, // task.category: "roofing"
  theme: { barCritical: "#be123c" },
});
gantt.setTheme({ bar: "#7c3aed" });
```

See [docs/theming.md](docs/theming.md) for every token, and `examples/theme-playground.html` to try
them.

### Optional entries

The core bundle stays under 45 KB gzip. Everything else is a separate import:

| Import                       | What                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `streamlined-gantt/engine`   | Scheduling and calendars without the DOM (Node, workers) |
| `streamlined-gantt/print`    | A3/A4 print, SVG and PNG export                          |
| `streamlined-gantt/io/mspdi` | MS Project XML import and export                         |
| `streamlined-gantt/io/csv`   | `exportCSV(gantt)`                                       |
| `streamlined-gantt/health`   | `check(gantt)`: SCL/CIOB programme health check          |
| `streamlined-gantt/toolbar`  | The built-in toolbar (`toolbar: buildToolbar`)           |

The script-tag build (`streamlined-gantt.iife.min.js`) includes the toolbar, so `toolbar: true`
works there.

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
