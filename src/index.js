// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * streamlined-gantt: framework-free Gantt and construction programme library.
 *
 * @module streamlined-gantt
 */

export { VERSION } from "./version.js";
export { Gantt } from "./ui/gantt.js";
export { ProgrammeController } from "./model/controller.js";
export { GanttEvent } from "./model/emitter.js";
export { EVENT_NAME_LIST } from "./model/event-names.js";
export { StreamlinedGanttElement, defineElement, defineConfig } from "./element.js";
export { trustedHTML } from "./ui/dom.js";
export { DEFAULT_STRINGS } from "./ui/strings.js";
export * from "./engine/index.js";
