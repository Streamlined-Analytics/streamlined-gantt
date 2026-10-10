// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * streamlined-gantt: framework-free Gantt chart and scheduling library.
 *
 * The core entry re-exports the engine API that integrations commonly need
 * (scheduling, calendars, dates, validation, formatting, summaries). CSV
 * export (`streamlined-gantt/io/csv`) and the health check
 * (`streamlined-gantt/health`) are optional entries. The
 * complete engine, including rarer helpers such as `fromGovUkBankHolidays`,
 * `paymentSchedule` and the calendar-argument wrappers like
 * `addWorkingDays(date, n, calendar)`, is the `streamlined-gantt/engine`
 * entry, which has no DOM code and runs in Node and workers.
 *
 * @module streamlined-gantt
 */

/** @typedef {import("./ui/gantt.js").GanttOptions} GanttOptions */
/** @typedef {import("./engine/types.js").Programme} Programme */
/** @typedef {import("./engine/types.js").Task} Task */
/** @typedef {import("./engine/types.js").Link} Link */
/** @typedef {import("./engine/types.js").Baseline} Baseline */
/** @typedef {import("./engine/types.js").DelayEvent} DelayEvent */
/** @typedef {import("./engine/calendar.js").CalendarDefinition} CalendarDefinition */
/** @typedef {import("./ui/theme.js").CategoryColour} CategoryColour */

export { VERSION } from "./version.js";
export { Gantt } from "./ui/gantt.js";
export { ProgrammeController } from "./model/controller.js";
export { GanttEvent } from "./model/emitter.js";
export { EVENT_NAME_LIST } from "./model/event-names.js";
export { StreamlinedGanttElement, defineElement, defineConfig } from "./element.js";
export { trustedHTML } from "./ui/dom.js";
export { DEFAULT_STRINGS } from "./ui/strings.js";
export * from "./engine/dates.js";
export { Calendar, CalendarHasNoWorkingTimeError } from "./engine/calendar.js";
export { schedule } from "./engine/scheduler.js";
export {
  GanttValidationError,
  collectProblems,
  validateProgramme,
  SCHEMA_ID,
  TASK_TYPES,
  LINK_TYPES,
  CONSTRAINT_TYPES,
  DELAY_KINDS,
} from "./engine/schema.js";
export { findCycle, wouldCreateCycle, expandLinks, buildHierarchy } from "./engine/graph.js";
export {
  isMilestone,
  isLocked,
  isComplete,
  isStarted,
  normaliseDatePatch,
  resolveLeafDates,
  schedulingCalendar,
} from "./engine/model.js";
export { FieldRegistry } from "./engine/fields.js";
export { analyse } from "./engine/analysis.js";
export { projectSummary } from "./engine/summary.js";
export {
  formatDate,
  formatLongDate,
  formatMoney,
  parseMoney,
  formatPercent,
  minorUnitScale,
} from "./engine/format.js";
