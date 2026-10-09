// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * The built-in toolbar, `streamlined-gantt/toolbar`: zoom, today, undo and
 * redo, critical path and baseline toggles. Optional, because most hosts
 * render their own toolbar in their own design system and call the API.
 *
 * @example
 * import { Gantt } from "streamlined-gantt";
 * import { buildToolbar } from "streamlined-gantt/toolbar";
 * new Gantt(host, { data, toolbar: buildToolbar });
 *
 * @module streamlined-gantt/toolbar
 */

export { buildToolbar } from "./ui/toolbar.js";
