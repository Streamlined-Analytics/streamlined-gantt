// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { daysInMonth, fromYMD, isoWeekday, toDay, toISO, toYMD } from "../engine/dates.js";
import { child, children, textOf } from "./xml.js";

/**
 * MSPDI calendars: a seven-day work week (`DayType` 1 = Sunday … 7 = Saturday)
 * plus exceptions. Export writes every exception as a plain date range
 * (`Type` 1). Import also expands the recurring kinds MS Project writes:
 * 7 every N days, 6 weekly (`DaysOfWeek` bitmap, Sunday = 1), 4 and 5 monthly
 * (absolute day, or relative such as "last Friday"), and 2 and 3 yearly.
 * Working times within a day are not modelled; a calendar is days only.
 *
 * @module io/mspdi-calendar
 */

/** @typedef {import("../engine/calendar.js").CalendarDefinition} CalendarDefinition */
/** @typedef {import("../engine/calendar.js").CalendarException} CalendarException */
/** @typedef {import("./xml.js").XmlElement} XmlElement */

const MAX_RECURRENCE_STEPS = 5000;

/**
 * @param {number} dayType MSPDI 1 = Sunday … 7 = Saturday
 * @returns {number} ISO weekday 1 = Monday … 7 = Sunday
 */
const isoFromDayType = (dayType) => (dayType === 1 ? 7 : dayType - 1);

/**
 * @param {number} day
 * @returns {number} 0 = Sunday … 6 = Saturday
 */
const sundayBasedWeekday = (day) => isoWeekday(day) % 7;

/**
 * @param {CalendarException} exception
 * @returns {{from: string, to: string}}
 */
function rangeOf(exception) {
  const from = exception.date ?? exception.from ?? "";
  return { from, to: exception.date ?? exception.to ?? from };
}

/**
 * Element pairs for one calendar.
 * @param {CalendarDefinition} definition
 * @param {number} uid
 * @param {{startTime: string, finishTime: string}} times
 * @returns {import("./xml.js").XmlChildren}
 */
export function calendarElements(definition, uid, times) {
  const workingTimes = [
    [
      "WorkingTimes",
      [
        [
          "WorkingTime",
          [
            ["FromTime", times.startTime],
            ["ToTime", times.finishTime],
          ],
        ],
      ],
    ],
  ];
  const workWeek = definition.workWeek ?? [1, 2, 3, 4, 5];
  const weekDays = [1, 2, 3, 4, 5, 6, 7].map((dayType) => {
    const working = workWeek.includes(isoFromDayType(dayType));
    return [
      "WeekDay",
      [["DayType", dayType], ["DayWorking", working ? 1 : 0], ...(working ? workingTimes : [])],
    ];
  });
  const exceptionList = [
    ...(definition.nonWorking ?? []).map((exception) => ({ exception, working: false })),
    ...(definition.working ?? []).map((exception) => ({ exception, working: true })),
  ];
  const exceptions = exceptionList.map(({ exception, working }) => {
    const { from, to } = rangeOf(exception);
    return [
      "Exception",
      [
        [
          "TimePeriod",
          [
            ["FromDate", `${from}T00:00:00`],
            ["ToDate", `${to}T23:59:00`],
          ],
        ],
        ["Occurrences", toDay(to) - toDay(from) + 1],
        ["Name", exception.name],
        ["Type", 1],
        ["DayWorking", working ? 1 : 0],
        ...(working ? workingTimes : []),
      ],
    ];
  });
  return [
    ["UID", uid],
    ["Name", definition.name ?? definition.id],
    ["IsBaseCalendar", 1],
    ["BaseCalendarUID", -1],
    ["WeekDays", weekDays],
    ...(exceptions.length ? [["Exceptions", exceptions]] : []),
  ];
}

/**
 * Reads the base calendars of a project. Resource calendars are skipped, and
 * a calendar that defines no week days keeps the default Monday-Friday week.
 * @param {XmlElement} project
 * @param {string[]} warnings
 * @returns {{uid: number, definition: CalendarDefinition}[]}
 */
export function readCalendars(project, warnings) {
  return children(child(project, "Calendars"), "Calendar")
    .filter((element) => textOf(element, "IsBaseCalendar") !== "0")
    .map((element) => {
      const uid = Number(textOf(element, "UID"));
      return { uid, definition: readCalendar(element, uid, warnings) };
    });
}

/**
 * @param {XmlElement} element
 * @param {number} uid
 * @param {string[]} warnings
 * @returns {CalendarDefinition}
 */
function readCalendar(element, uid, warnings) {
  /** @type {number[]} */
  const workWeek = [];
  let weekDefined = false;
  /** @type {{exception: CalendarException, working: boolean}[]} */
  const exceptions = [];
  const hasExceptionList = child(element, "Exceptions") !== undefined;
  for (const weekDay of children(child(element, "WeekDays"), "WeekDay")) {
    const dayType = Number(textOf(weekDay, "DayType"));
    const working = textOf(weekDay, "DayWorking") === "1";
    if (dayType >= 1 && dayType <= 7) {
      weekDefined = true;
      if (working) workWeek.push(isoFromDayType(dayType));
      continue;
    }
    if (!hasExceptionList) exceptions.push(...legacyException(weekDay, working));
  }
  for (const exception of children(child(element, "Exceptions"), "Exception")) {
    const working = textOf(exception, "DayWorking") === "1";
    for (const entry of expandException(exception, warnings))
      exceptions.push({ exception: entry, working });
  }
  workWeek.sort((first, second) => first - second);
  /** @type {CalendarDefinition} */
  const definition = { id: `cal-${uid}`, name: textOf(element, "Name") ?? `Calendar ${uid}` };
  if (weekDefined) definition.workWeek = workWeek;
  const nonWorking = exceptions.filter((entry) => !entry.working).map((entry) => entry.exception);
  const working = exceptions.filter((entry) => entry.working).map((entry) => entry.exception);
  if (nonWorking.length) definition.nonWorking = nonWorking;
  if (working.length) definition.working = working;
  return definition;
}

/**
 * Project 2003-style exceptions: a `WeekDay` with `DayType` 0 and a time
 * period. Later versions write these as well as an `Exceptions` list, so they
 * are read only when that list is absent.
 * @param {XmlElement} weekDay
 * @param {boolean} working
 * @returns {{exception: CalendarException, working: boolean}[]}
 */
function legacyException(weekDay, working) {
  const period = child(weekDay, "TimePeriod");
  const fromText = textOf(period, "FromDate");
  const toText = textOf(period, "ToDate");
  if (!fromText || !toText) return [];
  return [
    {
      exception: exceptionEntry(toDay(fromText.slice(0, 10)), lastDay(toText), undefined),
      working,
    },
  ];
}

/**
 * The last day an MSPDI `ToDate` covers: 23:59 on that day, or a midnight
 * that belongs to the day before.
 * @param {string} value
 * @returns {number}
 */
function lastDay(value) {
  const day = toDay(value.slice(0, 10));
  const time = value.slice(11, 19);
  return time && time <= "00:00:59" ? day - 1 : day;
}

/**
 * @param {number} from
 * @param {number} to
 * @param {string|undefined} name
 * @returns {CalendarException}
 */
function exceptionEntry(from, to, name) {
  /** @type {CalendarException} */
  const entry = from === to ? { date: toISO(from) } : { from: toISO(from), to: toISO(to) };
  if (name) entry.name = name;
  return entry;
}

/**
 * @typedef {object} Recurrence
 * @property {number} from first day of the range
 * @property {number} to last day of the range
 * @property {number} every the `Period`
 * @property {XmlElement} element
 */

/**
 * Expands one exception into single days (recurring) or one range.
 * @param {XmlElement} element
 * @param {string[]} warnings
 * @returns {CalendarException[]}
 */
function expandException(element, warnings) {
  const period = child(element, "TimePeriod");
  const fromText = textOf(period, "FromDate");
  const toText = textOf(period, "ToDate");
  if (!fromText || !toText) return [];
  const name = textOf(element, "Name") || undefined;
  /** @type {Recurrence} */
  const recurrence = {
    from: toDay(fromText.slice(0, 10)),
    to: lastDay(toText),
    every: Math.max(1, Number(textOf(element, "Period") ?? 1) || 1),
    element,
  };
  if (recurrence.to < recurrence.from) return [];
  const type = Number(textOf(element, "Type") ?? 1);
  const days = recurringDays(type, recurrence);
  if (days === null) {
    if (type !== 1)
      warnings.push(
        `Calendar exception "${name ?? ""}" has an unknown recurrence; read as one range`,
      );
    return [exceptionEntry(recurrence.from, recurrence.to, name)];
  }
  const limit = Number(textOf(element, "Occurrences") ?? 0) || Infinity;
  return days
    .filter((day) => day >= recurrence.from && day <= recurrence.to)
    .slice(0, limit)
    .map((day) => exceptionEntry(day, day, name));
}

/**
 * Candidate days for a recurring exception, or null for a plain range.
 * @param {number} type
 * @param {Recurrence} recurrence
 * @returns {number[]|null}
 */
function recurringDays(type, recurrence) {
  if (type === 1 && recurrence.every === 1) return null;
  if (type === 1 || type === 7) return everyNDays(recurrence);
  if (type === 6) return weekly(recurrence);
  if (type === 4 || type === 5) return monthly(type === 5, recurrence);
  if (type === 2 || type === 3) return yearly(type === 3, recurrence);
  return null;
}

/**
 * @param {Recurrence} recurrence
 * @returns {number[]}
 */
function everyNDays({ from, to, every }) {
  const days = [];
  for (let day = from; day <= to && days.length < MAX_RECURRENCE_STEPS; day += every)
    days.push(day);
  return days;
}

/**
 * Weeks run Sunday to Saturday and are counted from the week holding `from`.
 * @param {Recurrence} recurrence
 * @returns {number[]}
 */
function weekly({ from, to, every, element }) {
  const mask = Number(textOf(element, "DaysOfWeek") ?? 0);
  const firstSunday = from - sundayBasedWeekday(from);
  const days = [];
  for (let day = from; day <= to && days.length < MAX_RECURRENCE_STEPS; day += 1) {
    const inActiveWeek = Math.floor((day - firstSunday) / 7) % every === 0;
    if (inActiveWeek && mask & (1 << sundayBasedWeekday(day))) days.push(day);
  }
  return days;
}

/**
 * @param {boolean} relative
 * @param {Recurrence} recurrence
 * @returns {number[]}
 */
function monthly(relative, { from, to, every, element }) {
  const start = toYMD(from);
  const days = [];
  let monthIndex = start.year * 12 + start.month - 1;
  for (let step = 0; step < MAX_RECURRENCE_STEPS; step += 1, monthIndex += every) {
    const firstOfMonth = fromYMD(Math.floor(monthIndex / 12), (monthIndex % 12) + 1, 1);
    if (firstOfMonth > to) break;
    days.push(dayInMonth(relative, firstOfMonth, element));
  }
  return days;
}

/**
 * @param {boolean} relative
 * @param {Recurrence} recurrence
 * @returns {number[]}
 */
function yearly(relative, { from, to, element }) {
  const month = Math.min(12, Math.max(1, Number(textOf(element, "Month") ?? 0) + 1));
  const days = [];
  for (let year = toYMD(from).year; year <= toYMD(to).year; year += 1) {
    days.push(dayInMonth(relative, fromYMD(year, month, 1), element));
  }
  return days;
}

/**
 * @param {boolean} relative
 * @param {number} firstOfMonth
 * @param {XmlElement} element
 * @returns {number}
 */
function dayInMonth(relative, firstOfMonth, element) {
  if (relative) return relativeDay(firstOfMonth, element);
  const { year, month } = toYMD(firstOfMonth);
  const dayOfMonth = Math.max(1, Number(textOf(element, "MonthDay") ?? 1));
  return firstOfMonth + Math.min(dayOfMonth, daysInMonth(year, month)) - 1;
}

/**
 * The first to fourth, or last, given weekday of a month. `MonthItem` 3-9 is
 * Sunday-Saturday; `MonthPosition` 0-3 is first-fourth and 4 is last.
 * @param {number} firstOfMonth
 * @param {XmlElement} element
 * @returns {number}
 */
function relativeDay(firstOfMonth, element) {
  const item = Number(textOf(element, "MonthItem") ?? 3);
  const position = Number(textOf(element, "MonthPosition") ?? 0);
  const target = (item - 3 + 7) % 7;
  const { year, month } = toYMD(firstOfMonth);
  const first = firstOfMonth + ((target - sundayBasedWeekday(firstOfMonth) + 7) % 7);
  const last = firstOfMonth + daysInMonth(year, month) - 1;
  if (position >= 4) return last - ((sundayBasedWeekday(last) - target + 7) % 7);
  return first + 7 * Math.max(0, position);
}
