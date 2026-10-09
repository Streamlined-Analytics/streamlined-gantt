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

- `editor: (task, {gantt, readOnly}) => {...}` replaces the built-in dialog, for example to open
  your own modal or to load server-rendered HTML with htmx. Save through
  `gantt.updateTask(task.id, patch)`. `editor: "none"` disables editing in a dialog.
- `tooltip: (task) => string | Node | trustedHTML(html)`. Strings are rendered as text, never as
  HTML.
- `contextMenu: {items: [...]}`, or listen to `task-contextmenu` and show your own menu.
- The built-in toolbar is optional (`toolbar: buildToolbar` from `streamlined-gantt/toolbar`).
  Most sites build their own toolbar and call `setZoom`, `undo`, `redo`, `scrollToDate`,
  `setCriticalPathVisible` and so on.

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
