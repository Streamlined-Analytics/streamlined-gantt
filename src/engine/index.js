// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * The DOM-free engine: dates, calendars, scheduling, validation, summaries,
 * health check and CSV. Safe to import in Node, workers and tests.
 *
 * @module streamlined-gantt/engine
 */

import { Calendar } from "./calendar.js";

export { VERSION } from "../version.js";
export * from "./dates.js";
export { Calendar, CalendarHasNoWorkingTimeError, fromGovUkBankHolidays } from "./calendar.js";
export { schedule } from "./scheduler.js";
export {
  GanttValidationError,
  collectProblems,
  validateProgramme,
  SCHEMA_ID,
  TASK_TYPES,
  LINK_TYPES,
  CONSTRAINT_TYPES,
  DELAY_KINDS,
} from "./schema.js";
export { findCycle, wouldCreateCycle, expandLinks, buildHierarchy } from "./graph.js";
export {
  isMilestone,
  isLocked,
  isComplete,
  isStarted,
  normaliseDatePatch,
  resolveLeafDates,
  schedulingCalendar,
} from "./model.js";
export { FieldRegistry } from "./fields.js";
export { analyse } from "./analysis.js";
export { projectSummary, paymentSchedule, splitEvenly } from "./summary.js";
export { checkProgramme, MAX_ACTIVITY_DAYS } from "./health.js";
export { programmeToCSV, csvCell, minorToDecimal } from "./csv.js";
export {
  formatDate,
  formatLongDate,
  formatMoney,
  parseMoney,
  formatPercent,
  minorUnitScale,
} from "./format.js";

/**
 * @param {Calendar|import("./calendar.js").CalendarDefinition|undefined} calendar
 * @returns {Calendar}
 */
function asCalendar(calendar) {
  return calendar instanceof Calendar ? calendar : new Calendar(calendar ?? { id: "default" });
}

/**
 * Functional form of {@link Calendar#addWorkingDays}.
 * @template {string|number} T
 * @param {T} date
 * @param {number} count
 * @param {Calendar|import("./calendar.js").CalendarDefinition} [calendar] default Monday-Friday
 * @returns {T}
 */
export function addWorkingDays(date, count, calendar) {
  return asCalendar(calendar).addWorkingDays(date, count);
}

/**
 * Functional form of {@link Calendar#workingDaysBetween} (both ends inclusive).
 * @param {string|number} start
 * @param {string|number} finish
 * @param {Calendar|import("./calendar.js").CalendarDefinition} [calendar]
 * @returns {number}
 */
export function workingDaysBetween(start, finish, calendar) {
  return asCalendar(calendar).workingDaysBetween(start, finish);
}

/**
 * @param {string|number} date
 * @param {Calendar|import("./calendar.js").CalendarDefinition} [calendar]
 * @returns {boolean}
 */
export function isWorking(date, calendar) {
  return asCalendar(calendar).isWorking(date);
}

/**
 * @template {string|number} T
 * @param {T} date
 * @param {Calendar|import("./calendar.js").CalendarDefinition} [calendar]
 * @returns {T}
 */
export function nextWorkingDay(date, calendar) {
  return asCalendar(calendar).nextWorkingDay(date);
}

/**
 * @template {string|number} T
 * @param {T} date
 * @param {Calendar|import("./calendar.js").CalendarDefinition} [calendar]
 * @returns {T}
 */
export function previousWorkingDay(date, calendar) {
  return asCalendar(calendar).previousWorkingDay(date);
}
