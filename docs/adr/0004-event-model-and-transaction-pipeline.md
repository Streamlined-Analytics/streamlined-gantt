# 0004. One emitter mirrored to DOM events, and a transaction pipeline with asynchronous approval

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** events
- **Builds on:** none — first ADR for events
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

Integration quality is the selling point. Backends (Django with htmx, or fetch) must be able to:

- react to every interaction;
- approve, reject or correct each edit, synchronously or after a server round trip;
- save once per user action, even when a drag cascades through 40 successors.

hyperscript and htmx speak DOM events; JavaScript integrators want typed handlers.

## What did we try?

### Attempt 1 — DOM CustomEvents only ❌ rejected up front

DOM dispatch is synchronous and cannot carry "wait for this promise, then maybe use the
server's version instead". `preventDefault()` alone cannot express "correct".

### Attempt 2 — callback options per event ❌ rejected up front

DHTMLX-style callbacks (`onBeforeTaskUpdate: () => boolean`) cannot be added from hyperscript
and allow only one listener.

### Attempt 3 — one emitter, two faces, and transactions ✅ chosen

## What did we land on, and why?

- **One emitter.** `gantt.on/off/once` handlers receive a `GanttEvent`. The same object is
  re-dispatched on the host element as the `CustomEvent` `gantt:<name>`, with `bubbles: true`,
  as its `detail`. Only `before-*` events are cancelable; `preventDefault()` on either face
  vetoes. Event names are checked against `src/model/event-catalogue.js`, the single source of
  truth for the API reference. A test fails when a catalogue event has no trigger test.
- **Transactions.** Every mutation (drag, keyboard nudge, editor save, API call, `batch()`) is
  one transaction:
  1. It is applied tentatively, and the scheduler computes the cascade.
  2. One `before-*` event fires per requested operation, carrying the change, the old and new
     task, and the cascade.
  3. If any handler vetoes, everything rolls back and `edit-rejected` fires with a reason.
  4. If any handler calls `event.waitUntil(promise)`, the transaction waits (ExtendableEvent
     semantics; calling it after dispatch throws `InvalidStateError`). Then:
     - `false` or a rejected promise vetoes;
     - a changeset object replaces the local result with the server's;
     - anything else accepts.

     All handlers must accept. A 15 s timeout fails safe to "rejected".

  5. On commit, the transaction enters history, the after events fire (`task-update` per task,
     with cause `drag`/`api`/`keyboard` for the edited task and `schedule` for successors, then
     `field-change` per field), and then **exactly one** `change` fires.
- **Optimistic or confirm.** In `optimistic` mode the pending result is drawn with a pending
  style and rolled back on rejection. In `confirm` mode the old state stays, with
  `aria-busy="true"`, until the server answers. Transactions run one at a time; edits made while
  one is pending are queued in order.
- **One rejection event, named `edit-rejected`,** with
  `reason ∈ {vetoed, error, timeout, locked, cycle, validation, not-found, destroyed}`. Locked
  tasks and cycles are refused before any integrator handler runs.
- **Drag events.** `drag-start` → `drag-move` (at most once per animation frame, with the live
  cascade preview) → `drag-end` → then the transaction. Touch drags need the task to be selected
  first (tap, then drag), so scrolling stays native elsewhere. Long-press opens the context menu.
- **`whenIdle()`** resolves when no transaction is pending or queued. It is the anti-flake hook
  for tests and for hosts that need to wait.

## What does this cost us?

- Mutation methods return `Promise<EditResult>` even when they commit synchronously, because
  approval may be asynchronous. The data is updated synchronously when no handler waits.
- Before events fire after the tentative apply, so handlers see the full cascade. In optimistic
  mode a vetoed edit can therefore flash; confirm mode avoids that.
- The event catalogue must be kept in step with the code; the coverage test enforces it.
