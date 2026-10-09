// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * The single source of truth for every event the library emits. The API
 * reference table is generated from this list, and a test fails when an event
 * has no test. DOM mirrors are dispatched as `gantt:<name>`.
 *
 * @module model/event-catalogue
 */

/**
 * @typedef {object} EventSpec
 * @property {string} name
 * @property {string} group
 * @property {string[]} payload top-level keys of the event object (besides `type`)
 * @property {string} description
 */

const MUTATION_PAYLOAD = ["transactionId", "label", "cause"];

/** @type {EventSpec[]} */
export const EVENT_CATALOGUE = [
  {
    name: "task-click",
    group: "pointer",
    payload: ["taskId", "task", "originalEvent"],
    description: "A bar, milestone or task row was clicked.",
  },
  {
    name: "task-dblclick",
    group: "pointer",
    payload: ["taskId", "task", "originalEvent"],
    description: "A bar was double-clicked (opens the editor unless prevented).",
  },
  {
    name: "task-contextmenu",
    group: "pointer",
    payload: ["taskId", "task", "originalEvent"],
    description: "Context menu requested on a task (right-click, long-press, Shift+F10).",
  },
  {
    name: "milestone-click",
    group: "pointer",
    payload: ["taskId", "task", "originalEvent"],
    description: "A milestone was clicked. task-click fires too.",
  },
  {
    name: "link-click",
    group: "pointer",
    payload: ["linkId", "link", "originalEvent"],
    description: "A dependency arrow was clicked.",
  },
  {
    name: "link-dblclick",
    group: "pointer",
    payload: ["linkId", "link", "originalEvent"],
    description: "A dependency arrow was double-clicked.",
  },
  {
    name: "row-click",
    group: "pointer",
    payload: ["taskId", "column", "originalEvent"],
    description: "A grid row was clicked.",
  },
  {
    name: "cell-click",
    group: "pointer",
    payload: ["date", "rowTaskId", "originalEvent"],
    description: "Empty timeline space was clicked; carries the date and the row's task.",
  },
  {
    name: "delay-click",
    group: "pointer",
    payload: ["delayId", "delay", "originalEvent"],
    description: "A delay band was clicked.",
  },
  {
    name: "task-hover-start",
    group: "pointer",
    payload: ["taskId", "task"],
    description: "The pointer entered a bar.",
  },
  {
    name: "task-hover-end",
    group: "pointer",
    payload: ["taskId", "task"],
    description: "The pointer left a bar.",
  },
  {
    name: "selection-change",
    group: "selection",
    payload: ["selected", "added", "removed"],
    description: "The selected task ids changed.",
  },
  {
    name: "drag-start",
    group: "drag",
    payload: ["kind", "taskId", "from", "to", "pointerType"],
    description:
      "A drag began (move, resize-start, resize-end, progress or link) after the movement threshold.",
  },
  {
    name: "drag-move",
    group: "drag",
    payload: ["kind", "taskId", "from", "to", "preview", "pointerType"],
    description:
      "Live drag position, at most once per animation frame. `preview` holds the cascaded dates of every affected task.",
  },
  {
    name: "drag-end",
    group: "drag",
    payload: ["kind", "taskId", "from", "to", "cancelled", "pointerType"],
    description: "The drag finished or was cancelled (Esc, pointercancel).",
  },
  {
    name: "before-task-add",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "task", "changes", "cascade"],
    description: "Cancelable. A task is about to be added.",
  },
  {
    name: "before-task-update",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "id", "old", "new", "changes", "changedFields", "cascade"],
    description:
      "Cancelable. A task is about to change; `cascade` lists the successors the scheduler will move.",
  },
  {
    name: "before-task-remove",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "id", "task", "cascade"],
    description:
      "Cancelable. A task (and, with cascade, its children and links) is about to be removed.",
  },
  {
    name: "before-link-add",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "link", "cascade"],
    description: "Cancelable. A dependency is about to be added.",
  },
  {
    name: "before-link-update",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "id", "old", "new", "changes", "cascade"],
    description: "Cancelable. A dependency is about to change.",
  },
  {
    name: "before-link-remove",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "id", "link", "cascade"],
    description: "Cancelable. A dependency is about to be removed.",
  },
  {
    name: "before-delay-add",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "delay"],
    description: "Cancelable. A delay event is about to be recorded.",
  },
  {
    name: "before-delay-update",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "id", "old", "new", "changes"],
    description: "Cancelable. A delay event is about to change.",
  },
  {
    name: "before-delay-remove",
    group: "before",
    payload: [...MUTATION_PAYLOAD, "id", "delay"],
    description: "Cancelable. A delay event is about to be removed.",
  },
  {
    name: "before-editor-open",
    group: "before",
    payload: ["taskId", "task", "mode"],
    description:
      "Cancelable. The built-in editor is about to open; prevent it to show your own modal.",
  },
  {
    name: "task-add",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "task"],
    description: "A task was added.",
  },
  {
    name: "task-update",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "old", "new", "changedFields"],
    description: 'A task changed. Scheduled successors carry cause "schedule".',
  },
  {
    name: "task-remove",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "task"],
    description: "A task was removed.",
  },
  {
    name: "link-add",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "link"],
    description: "A dependency was added.",
  },
  {
    name: "link-update",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "old", "new", "changedFields"],
    description: "A dependency changed.",
  },
  {
    name: "link-remove",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "link"],
    description: "A dependency was removed.",
  },
  {
    name: "delay-add",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "delay"],
    description: "A delay event was recorded.",
  },
  {
    name: "delay-update",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "old", "new", "changedFields"],
    description: "A delay event changed.",
  },
  {
    name: "delay-remove",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "id", "delay"],
    description: "A delay event was removed.",
  },
  {
    name: "project-update",
    group: "mutation",
    payload: [...MUTATION_PAYLOAD, "key", "old", "new"],
    description: "A programme-level property (data date, revision, baselines, markers…) changed.",
  },
  {
    name: "field-change",
    group: "fields",
    payload: ["taskId", "field", "old", "new", "cause", "transactionId"],
    description: "One custom field (or core task property) changed on one task.",
  },
  {
    name: "validation-error",
    group: "fields",
    payload: ["taskId", "field", "value", "message"],
    description: "A value failed validation and the edit was blocked.",
  },
  {
    name: "change",
    group: "batch",
    payload: [...MUTATION_PAYLOAD, "changes", "source"],
    description:
      "Exactly one per committed transaction (a drag with its cascade, an editor save, batch(), undo, applyPatch). Save back on this.",
  },
  {
    name: "edit-rejected",
    group: "batch",
    payload: [
      "transactionId",
      "label",
      "cause",
      "reason",
      "taskIds",
      "linkIds",
      "message",
      "error",
    ],
    description:
      "An edit was vetoed, failed validation, timed out, or was refused (locked, cycle, read-only). Nothing was committed.",
  },
  {
    name: "zoom-change",
    group: "view",
    payload: ["zoom", "previous"],
    description: "The zoom level changed.",
  },
  {
    name: "scroll",
    group: "view",
    payload: ["fromDate", "toDate", "firstRow", "lastRow"],
    description: "The visible window changed (debounced).",
  },
  {
    name: "expand-change",
    group: "view",
    payload: ["taskId", "expanded"],
    description: "A summary was expanded or collapsed.",
  },
  {
    name: "lookahead-change",
    group: "view",
    payload: ["lookahead"],
    description: "The lookahead window was set or cleared.",
  },
  {
    name: "filter-change",
    group: "view",
    payload: ["active"],
    description: "A filter was set or cleared.",
  },
  {
    name: "readonly-change",
    group: "view",
    payload: ["readOnly"],
    description: "Read-only mode was switched.",
  },
  {
    name: "baseline-visibility-change",
    group: "view",
    payload: ["baselineId"],
    description: "A different baseline (or none) is shown.",
  },
  {
    name: "critical-path-visibility-change",
    group: "view",
    payload: ["visible"],
    description: "Critical path highlighting was switched.",
  },
  {
    name: "load",
    group: "lifecycle",
    payload: ["programme"],
    description: "Data was loaded (constructor, load(), loadURL(), or the element's src).",
  },
  {
    name: "render",
    group: "lifecycle",
    payload: ["firstRow", "lastRow", "durationMs"],
    description: "A render pass completed.",
  },
  {
    name: "schedule",
    group: "lifecycle",
    payload: ["critical", "violations", "projectStart", "projectFinish"],
    description: "Analysis finished after a load or a committed change.",
  },
  {
    name: "error",
    group: "lifecycle",
    payload: ["error", "message"],
    description: "A recoverable error (for example a failed src fetch).",
  },
  { name: "destroy", group: "lifecycle", payload: [], description: "The instance was destroyed." },
  {
    name: "editor-open",
    group: "editor",
    payload: ["taskId", "mode"],
    description: "The built-in editor opened.",
  },
  {
    name: "editor-save",
    group: "editor",
    payload: ["taskId", "values"],
    description: "The built-in editor saved; `values` is the patch it sent.",
  },
  {
    name: "editor-close",
    group: "editor",
    payload: ["taskId", "saved"],
    description: "The built-in editor closed.",
  },
  {
    name: "menu-action",
    group: "editor",
    payload: ["action", "taskId", "date"],
    description: "A context-menu item was chosen.",
  },
];

export { EVENT_NAMES, isCancelable } from "./event-names.js";
