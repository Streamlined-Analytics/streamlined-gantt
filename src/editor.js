// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { openTaskEditor } from "./ui/editor.js";

export { openTaskEditor, defaultEditorFields } from "./ui/editor.js";

/**
 * The built-in task editor dialog, `streamlined-gantt/editor`: name, dates,
 * duration, progress, type, notes and custom fields, with validation through
 * `updateTask`. Optional, to keep the core small; the script-tag build
 * includes it. Many hosts open their own modal instead (see docs/integration.md).
 *
 * @example
 * import { Gantt } from "streamlined-gantt";
 * import { builtinEditor } from "streamlined-gantt/editor";
 * new Gantt(host, { data, editor: builtinEditor });
 *
 * @module streamlined-gantt/editor
 */

/**
 * An `editor` option value that opens the built-in dialog.
 * @param {Readonly<Record<string, any>>} task
 * @param {{gantt: import("./ui/gantt.js").Gantt}} context
 * @returns {boolean} whether the dialog opened
 */
export function builtinEditor(task, context) {
  return openTaskEditor(context.gantt, task.id);
}
