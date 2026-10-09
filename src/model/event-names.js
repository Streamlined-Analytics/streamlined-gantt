// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Every event name the library emits. The documented catalogue (payloads and
 * descriptions) is `streamlined-gantt/events` (src/model/event-catalogue.js);
 * this compact list is what the core bundle needs.
 *
 * @module model/event-names
 */

/** @type {readonly string[]} */
export const EVENT_NAME_LIST = Object.freeze([
  "task-click",
  "task-dblclick",
  "task-contextmenu",
  "milestone-click",
  "link-click",
  "link-dblclick",
  "row-click",
  "cell-click",
  "delay-click",
  "task-hover-start",
  "task-hover-end",
  "selection-change",
  "drag-start",
  "drag-move",
  "drag-end",
  "before-task-add",
  "before-task-update",
  "before-task-remove",
  "before-link-add",
  "before-link-update",
  "before-link-remove",
  "before-delay-add",
  "before-delay-update",
  "before-delay-remove",
  "before-editor-open",
  "task-add",
  "task-update",
  "task-remove",
  "link-add",
  "link-update",
  "link-remove",
  "delay-add",
  "delay-update",
  "delay-remove",
  "project-update",
  "field-change",
  "validation-error",
  "change",
  "edit-rejected",
  "zoom-change",
  "scroll",
  "expand-change",
  "lookahead-change",
  "filter-change",
  "readonly-change",
  "baseline-visibility-change",
  "critical-path-visibility-change",
  "load",
  "render",
  "schedule",
  "error",
  "destroy",
]);

/** Every event name. */
export const EVENT_NAMES = new Set(EVENT_NAME_LIST);

/**
 * Only `before-*` events can be vetoed or deferred.
 * @param {string} name
 * @returns {boolean}
 */
export function isCancelable(name) {
  return name.startsWith("before-");
}
