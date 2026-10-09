# 0006. Undo never overwrites a non-undoable server patch

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** history
- **Builds on:** ADR-0004 (events)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

Backends can push authoritative changes with `applyPatch(changeset, {undoable: false})`, for
example dates recomputed by a server-side scheduler, or another user's edit broadcast over a
socket. If the local user then presses Ctrl+Z, undoing an older local edit to the same task
would silently overwrite the server's data with stale values.

## What did we try?

### Attempt 1 — clear all history on any non-undoable patch ❌ rejected

Safe, but a patch to an unrelated task would wipe the user's undo stack. That is surprising
during collaborative editing.

### Attempt 2 — rebase history entries over the patch ❌ rejected

Operational-transform style rebasing is far more machinery than an SME programme editor needs,
and its edge cases are hard to test and explain.

### Attempt 3 — truncate history at the newest entry that touches a patched entity ✅ chosen

## What did we land on, and why?

When a non-undoable patch touches an entity (a task, link, delay event, marker, baseline or
programme property):

1. Every history entry that touched the same entity is discarded, together with everything older
   than it.
2. Entries newer than the last conflicting one stay undoable. They only touch other entities.
3. The redo stack is cleared.

Undo therefore never writes values that predate the server's version, and unrelated recent
edits remain undoable. Undoable patches (the default) are ordinary history entries.

Pinned by `tests/unit/controller.test.js` ("undo never overwrites a non-undoable server
patch") and the model-based history property test.

## What does this cost us?

Granularity is per entity, not per field. A server patch that renames a task also drops undo
of an older local date change to that task. This is a deliberately conservative choice.
