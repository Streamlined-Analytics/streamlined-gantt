# Integration guide

How a backend sees, approves and corrects edits. There are working examples of each pattern,
served by `npm run serve` against the mock backend in `examples/mock-backend.mjs`.

| Pattern                         | When                                                 | Example                        |
| ------------------------------- | ---------------------------------------------------- | ------------------------------ |
| Save after the fact (htmx)      | The server rarely disagrees; edits must feel instant | `examples/htmx-save-back.html` |
| Approve before commit (`fetch`) | The server must validate every edit                  | `examples/fetch-approval.html` |
| Push from the server            | Another user or a server-side scheduler changed data | `applyPatch()` / `gantt:patch` |

## Events

Every committed transaction emits exactly one `change` event. That covers a drag with its
cascade, an editor save, `batch()`, undo and `applyPatch`. Save back on `change`:

```js
gantt.on("change", (event) => {
  if (event.source === "server") return; // it came from the server; don't echo it back
  save(event.changes); // {tasks: {added, updated: [{id, old, new, changedFields}], removed}, links: …, project: …}
});
```

DOM mirrors bubble from the host element as `gantt:<event>` `CustomEvent`s, with the same
object as `detail`. `docs/events.md` lists every event and its payload.

## Save after the fact with htmx

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

The server applies `changes`, then replies:

- **saved:** `200`, optionally with `HX-Trigger: {"save-status": {...}}` for your own UI;
- **rejected or corrected:** `HX-Trigger: {"gantt:patch": {"target": "#job", "changes": <changeset>}}`.
  htmx dispatches `gantt:patch` on `#job` (htmx treats `target` as a selector). The element
  applies it with `applyPatch()`. To revert, send each changed task's `old` record. To correct,
  send the corrected records.

A changeset is `{tasks: {add: [...], update: [{id, ...fields}], remove: [ids]}, links: …, project: {...}}`.
`update` merges fields into the existing record, so send `start`, `finish` and `duration`
together.

In Django, for example:

```python
response = HttpResponse(status=200)
response["HX-Trigger"] = json.dumps({"gantt:patch": {"target": "#job", "changes": changeset}})
return response
```

## Approve before commit with fetch

`before-*` events are cancelable. `event.waitUntil(promise)` holds the edit, which stays on
screen until the promise settles:

| The promise resolves to                                    | Result                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `undefined` (or anything that is not an object or `false`) | approved as made                                            |
| `false`, or it rejects                                     | rejected: the edit is undone and `edit-rejected` fires      |
| a changeset object                                         | corrected: the server's changeset replaces the local result |

```js
gantt.on("before-task-update", (event) => {
  event.waitUntil(
    fetch(`/jobs/42/tasks/${event.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
      body: JSON.stringify({ task: event.new, cascade: event.cascade }),
    }).then((response) => {
      if (response.status === 204) return undefined;
      if (response.status === 409) return false;
      return response.json();
    }),
  );
});
```

A correcting changeset is applied without rescheduling, so include every task the correction
moves (the mock backend reschedules with `streamlined-gantt/engine` and returns all of them).
Pending edits time out after `approvalTimeout` (15 s), and are released when the chart is
destroyed.

## Push from the server

```js
gantt.applyPatch(changeset, { undoable: false }); // e.g. from a WebSocket
```

A non-undoable patch also trims the undo history, so undo never overwrites the server's data
(ADR-0006). With `<streamlined-gantt listen-patch>`, dispatch `gantt:patch` on the document, or
send it in an `HX-Trigger` header.

## Custom editor, tooltip and menu

- The built-in dialog is `editor: builtinEditor` from `streamlined-gantt/editor` (included and on
  by default in the script-tag build).
- `editor: (task, {gantt, readOnly}) => {...}` replaces the built-in dialog, for example to open
  your own modal or to load server-rendered HTML with htmx. Save through
  `gantt.updateTask(task.id, patch)`. `editor: "none"` disables editing in a dialog.
- `tooltip: (task) => string | Node | trustedHTML(html)`. Strings are rendered as text, never as
  HTML.
- `contextMenu: {items: [...]}`, or listen to `task-contextmenu` and show your own menu.
- The built-in toolbar is optional (`toolbar: buildToolbar` from `streamlined-gantt/toolbar`).
  Most sites build their own toolbar and call `setZoom`, `undo`, `redo`, `scrollToDate`,
  `setCriticalPathVisible` and so on.

## Phones

`streamlined-gantt/mobile` (ADR-0011) makes the chart work on a phone, and gives it a full-screen
mode on every screen size:

- **Held upright** (the host narrower than `breakpoint`, 600 px by default), the chart is replaced
  by a summary: the programme's dates, an **Open the chart** button and one row per task with its
  dates and a mini bar on a shared track. It has no inner scroll; the page scrolls. Tapping a row
  opens the chart at that task.
- **Full screen**, on any screen (the **Open the chart** button, the expand button, `F`, or
  `gantt.enterFullscreen()`): where the browser has the Fullscreen API (desktops, Android, iPad)
  the chart's own stage element goes fullscreen; on touch screens it also asks for a landscape
  lock. iPhones have no element fullscreen, so they get a full-viewport modal dialog instead, and
  a "turn your phone sideways" hint while upright. Either way the chart fits the width, rows
  shrink (down to 24 px) so the whole programme fits the height, a rail holds close, zoom in, zoom
  out and fit, two fingers pinch to zoom, focus stays inside, and Escape (or leaving fullscreen
  from the browser) returns to the page with the chart's zoom and focus restored.
- **Wider** (a phone on its side, tablets, desktops), the chart shows as usual with a full-screen
  button: a **Full screen** button in the built-in toolbar when there is one, else an expand
  button in the chart's top-right corner. `expandButton: false` hides it.

### ES modules

```js
import { Gantt } from "streamlined-gantt";
import { mobileView } from "streamlined-gantt/mobile";

const gantt = new Gantt(host, { data, layout: "timeline", fit: "width" });
mobileView(gantt, { breakpoint: 600 }); // also gantt.mobile
myOwnButton.addEventListener("click", () => gantt.toggleFullscreen()); // from a click, for the API
```

### Script tag and the element

```html
<link rel="stylesheet" href="/static/streamlined-gantt/streamlined-gantt.css" />
<script src="/static/streamlined-gantt/streamlined-gantt.iife.min.js" defer></script>
<script src="/static/streamlined-gantt/mobile.iife.min.js" defer></script>

<streamlined-gantt src="/jobs/42/programme.json" layout="timeline" fit="width" mobile>
</streamlined-gantt>
```

The add-on installs itself on `StreamlinedGantt.Gantt`, so `new StreamlinedGantt.Gantt(host,
{data, mobile: {breakpoint: 600}})` works too, as does `StreamlinedGanttMobile.mobileView(gantt)`.

### Options

| Option         | Default       | Meaning                                                                   |
| -------------- | ------------- | ------------------------------------------------------------------------- |
| `breakpoint`   | `600`         | Host width (px) below which the summary replaces the chart                |
| `preview`      | `true`        | `false` keeps the chart on narrow hosts (the expand button still works)   |
| `expandButton` | `true`        | `false` hides the expand button; call `mobile.open()` from your own       |
| `fullscreen`   | `"auto"`      | Fullscreen API on touch devices (`"auto"`), `"always"` or `"never"`       |
| `orientation`  | `"landscape"` | Lock to landscape while full screen where supported, or `"any"`           |
| `minRowHeight` | `24`          | Smallest row when fitting the rows to the screen (WCAG 2.5.8 target size) |
| `maxRowHeight` | `44`          | Largest fitted row                                                        |
| `pinchZoom`    | `true`        | Two-finger pinch zooms the full-screen chart                              |
| `strings`      | English       | `MOBILE_STRINGS` keys, e.g. `{mobileOpen: "View the programme"}`          |

On the chart: `gantt.enterFullscreen({taskId})` (a promise; call it from a click or key press so
the browser allows fullscreen), `gantt.exitFullscreen()`, `gantt.toggleFullscreen()` and
`gantt.isFullscreen`. Without the add-on, `enterFullscreen()` rejects with an error saying so. On
the handle (`gantt.mobile`): `open()`, `close()`, `toggle()`, `opened`, `mode` (`"inline"`,
`"preview"` or `"fullscreen"`) and `destroy()` (also called by `gantt.destroy()`).

### Events

`layout-change` (`mode`, `previous`, `orientation`, `width`) fires when the presentation changes,
and `fullscreen-change` (`open`, `native`, `orientation`) when the full-screen chart opens or
closes; `native` is true when the Fullscreen API is in use. Like every event they bubble from the host as
`gantt:layout-change` and `gantt:fullscreen-change`, so a page can, for example, hide its own
table while the summary is showing, or pause a live chart while the full-screen one is open.

### Styling

The summary is its own `.sg-root` next to the chart, and the full-screen dialog stays inside the
host element (in the browser's top layer), so a host rule such as
`[data-gantt-host] .sg-root { --sg-bar: …; }` themes all three. The call to action has its own
tokens (`--sg-cta-bg`, `--sg-cta-fg`, `--sg-cta-radius`); see the phone section of
[theming.md](theming.md). Add `viewport-fit=cover` to the page's viewport meta so the full-screen
chart can pad itself clear of the notch and home indicator (`env(safe-area-inset-*)`).

The built-in editor becomes a full-width bottom sheet below 600 px, and on touch screens every
input and button is at least 44 px tall with 16 px text, so iOS does not zoom into a field. The
built-in toolbar folds everything after Today behind a **More** button when it is narrower than
560 px.

## Content Security Policy

The chart works under a strict policy (`script-src 'self'; style-src 'self'`, no `eval`): it sets
styles through the CSSOM, never through `style` attributes or inline `<style>`, and inserts HTML
only for content you mark with `trustedHTML()`. `examples/strict-csp.html` is served with that
policy, and a test fails on any violation.

One exception: the print module's document SVG carries its own `<style>` element, so that
exported SVG files stand alone. Appending that SVG to a page with a strict `style-src` (for
example, an in-page print preview) needs a nonce or hash for it. Exports, downloads and
`print()` (which uses its own frame) are unaffected.

## Styling

See [theming.md](theming.md).
