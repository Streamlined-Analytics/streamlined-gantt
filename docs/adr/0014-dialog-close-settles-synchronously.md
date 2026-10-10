# 0014. Closing a dialog from code settles it at once

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** ui/dialog, ui/editor, events (`editor-close`)
- **Builds on:** ADR-0004 (event model and transaction pipeline)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

The first nightly run of the DOM tests in Firefox and WebKit failed
`tests/dom/editing-ui.test.js`, "built-in editor … saves through updateTask". The event
sequence stopped at `editor-save`, and `editor-close` was missing. The test awaits
`gantt.whenIdle()` and one animation frame, by which point the dialog was no longer open.

`openDialog` resolved its `closed` promise, removed the element and restored focus from the
dialog's `close` event, and the editor emits `editor-close` from `closed`. The HTML spec has
`dialog.close()` queue that event as a task. Browsers order that task differently relative to
animation frames, so in Firefox and WebKit `editor-close` arrived after the point where Chromium
had already delivered it. A host that reacts to `editor-save` or the end of the save could see a
closed dialog that was still in the DOM, with focus not yet restored and no `editor-close` yet.

## What did we try?

### Option 1: wait longer in the test ❌ rejected

Another frame or a poll would pass the test, but it would hide a real cross-browser difference
in when a public event fires.

### Option 2: settle from `close()` as well as the `close` event ✅ chosen

When our code closes the dialog, `handle.close()` calls `dialog.close(value)` and then settles at
once. Settling resolves `closed`, removes the element and restores focus. The `close` event
listener stays, for closes we do not start (Esc, or a form with `method="dialog"`). A `settled`
flag makes the second call a no-op, so the order does not matter. We used a flag rather than
`isConnected` so a dialog removed by `destroy()` still settles.

## What did we land on, and why?

Option 2. `editor-close` (and every other `closed` consumer, such as `confirmDialog`) now fires
on the microtask after the save in every browser, and the editing-ui test passes in all three
engines with no timing changes.

## What does this cost us?

- Esc still settles on the native `close` event, so its timing still varies slightly by
  browser. No test or event contract depends on that timing today.
