// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { fromYMD, isoWeekday, toDay, toISO, toYMD, asDay } from "./dates.js";

/**
 * @typedef {object} CalendarException
 * @property {string} [date] a single ISO date
 * @property {string} [from] first ISO date of a range (inclusive)
 * @property {string} [to] last ISO date of a range (inclusive)
 * @property {string} [name]
 * @property {string} [kind] e.g. "bank-holiday", "shutdown", "weather"
 */

/**
 * @typedef {object} CalendarDefinition
 * @property {string} id
 * @property {string} [name]
 * @property {number[]} [workWeek] ISO weekdays that are working days (default Monday-Friday)
 * @property {CalendarException[]} [nonWorking] holidays, shutdowns and weather days
 * @property {CalendarException[]} [working] working exceptions, e.g. a Saturday worked
 */

const EPOCH_YEAR = 2000;
const MAX_RANGE_DAYS = 3660;
const MAX_SEARCH_YEARS = 400;
const MAX_EMPTY_YEARS = 10;
/** ISO dates are limited to years 0000-9999; refusing indexes beyond them avoids year-by-year walks of millions of years. */
const MIN_YEAR = 0;
const MAX_YEAR = 9999;
const DEFAULT_WORK_WEEK = [1, 2, 3, 4, 5];

/**
 * Thrown when a calendar has no working time within a ten-year search window
 * (for example every weekday excluded), instead of looping forever.
 */
export class CalendarHasNoWorkingTimeError extends Error {
  /**
   * @param {string} calendarId
   * @param {number} index the working index that could not be placed
   */
  constructor(calendarId, index) {
    super(
      `Calendar "${calendarId}" has no working days within ten years of working index ${index}`,
    );
    this.name = "CalendarHasNoWorkingTimeError";
    this.calendarId = calendarId;
    this.index = index;
  }
}

/**
 * @param {CalendarException} exception
 * @returns {number[]}
 */
function expandException(exception) {
  if (exception.date) return [toDay(exception.date)];
  const first = toDay(exception.from);
  const last = toDay(exception.to);
  const length = Math.min(last - first + 1, MAX_RANGE_DAYS);
  return Array.from({ length: Math.max(length, 0) }, (_, offset) => first + offset);
}

/**
 * A working-day calendar: a work week plus non-working and working exceptions.
 *
 * Working-day arithmetic is done through a *working index*: the number of
 * working days before a given day, counted from 1 January 2000. Adding N
 * working days is index arithmetic, and the scheduler runs its forward and
 * backward passes entirely in index space. Per-year cumulative tables are
 * built lazily and cached, so lookups are O(1) after the first touch of a year.
 *
 * Every public method accepts an ISO string or a day number and returns the
 * same kind it was given.
 */
export class Calendar {
  /** @param {CalendarDefinition} [definition] */
  constructor(definition = { id: "default" }) {
    this.id = definition.id;
    this.name = definition.name ?? definition.id;
    this.workWeek = new Set(definition.workWeek ?? DEFAULT_WORK_WEEK);
    /** @type {Map<number, CalendarException>} */
    this.nonWorking = new Map();
    /** @type {Map<number, CalendarException>} */
    this.working = new Map();
    for (const exception of definition.nonWorking ?? []) {
      for (const day of expandException(exception)) this.nonWorking.set(day, exception);
    }
    for (const exception of definition.working ?? []) {
      for (const day of expandException(exception)) this.working.set(day, exception);
    }
    /** @type {Map<number, {start: number, cumulative: Int32Array}>} */
    this.yearTables = new Map();
    /** @type {Map<number, Set<number>>} */
    this.exceptionDaysByYear = new Map();
    for (const day of [...this.nonWorking.keys(), ...this.working.keys()]) {
      const { year } = toYMD(day);
      if (!this.exceptionDaysByYear.has(year)) this.exceptionDaysByYear.set(year, new Set());
      this.exceptionDaysByYear.get(year).add(day);
    }
    /** @type {Map<number, number>} */
    this.yearOffsets = new Map([[EPOCH_YEAR, 0]]);
  }

  /**
   * @param {number} day
   * @returns {boolean}
   */
  isWorkingDayNumber(day) {
    if (this.working.has(day)) return true;
    if (this.nonWorking.has(day)) return false;
    return this.workWeek.has(isoWeekday(day));
  }

  /**
   * @param {string|number} date
   * @returns {boolean}
   */
  isWorking(date) {
    return this.isWorkingDayNumber(asDay(date));
  }

  /**
   * The named exception that makes a day non-working, if any.
   * @param {string|number} date
   * @returns {CalendarException|null}
   */
  nonWorkingReason(date) {
    const day = asDay(date);
    if (this.working.has(day)) return null;
    return this.nonWorking.get(day) ?? null;
  }

  /**
   * @param {number} year
   * @returns {{start: number, cumulative: Int32Array}}
   */
  yearTable(year) {
    const cached = this.yearTables.get(year);
    if (cached) return cached;
    const start = fromYMD(year, 1, 1);
    const length = fromYMD(year + 1, 1, 1) - start;
    const cumulative = new Int32Array(length + 1);
    for (let offset = 0; offset < length; offset += 1) {
      cumulative[offset + 1] =
        cumulative[offset] + (this.isWorkingDayNumber(start + offset) ? 1 : 0);
    }
    const table = { start, cumulative };
    this.yearTables.set(year, table);
    return table;
  }

  /**
   * @param {number} year
   * @returns {number}
   */
  workingDaysInYear(year) {
    const cached = this.yearTables.get(year);
    if (cached) return cached.cumulative[cached.cumulative.length - 1];
    const start = fromYMD(year, 1, 1);
    const length = fromYMD(year + 1, 1, 1) - start;
    let count = 0;
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      if (!this.workWeek.has(weekday)) continue;
      const firstOffset = (weekday - isoWeekday(start) + 7) % 7;
      count += Math.floor((length - 1 - firstOffset) / 7) + 1;
    }
    for (const day of this.exceptionDaysByYear.get(year) ?? []) {
      const regular = this.workWeek.has(isoWeekday(day));
      count += (this.isWorkingDayNumber(day) ? 1 : 0) - (regular ? 1 : 0);
    }
    return count;
  }

  /**
   * Working days between 1 January 2000 and 1 January of `year` (negative before 2000).
   * @param {number} year
   * @returns {number}
   */
  yearOffset(year) {
    const cached = this.yearOffsets.get(year);
    if (cached !== undefined) return cached;
    const step = year > EPOCH_YEAR ? -1 : 1;
    let known = year;
    while (!this.yearOffsets.has(known)) known += step;
    let offset = this.yearOffsets.get(known);
    while (known !== year) {
      if (step === -1) {
        offset += this.workingDaysInYear(known);
        known += 1;
      } else {
        known -= 1;
        offset -= this.workingDaysInYear(known);
      }
      this.yearOffsets.set(known, offset);
    }
    return offset;
  }

  /**
   * The working index of a day: how many working days fall before it.
   * The index of a working day is that day's position; a non-working day
   * shares its index with the next working day.
   * @param {number} day
   * @returns {number}
   */
  indexOf(day) {
    const { year } = toYMD(day);
    const table = this.yearTable(year);
    return this.yearOffset(year) + table.cumulative[day - table.start];
  }

  /**
   * The working day at a working index (inverse of {@link Calendar#indexOf} on working days).
   * @param {number} index
   * @returns {number} day number
   */
  dayAt(index) {
    let year = EPOCH_YEAR + Math.floor(index / 261);
    if (!(year >= MIN_YEAR && year <= MAX_YEAR)) {
      throw new RangeError(`Working index ${index} is outside the years ${MIN_YEAR}-${MAX_YEAR}`);
    }
    let emptyYears = 0;
    for (let guard = 0; guard < MAX_SEARCH_YEARS && emptyYears < MAX_EMPTY_YEARS; guard += 1) {
      const offset = this.yearOffset(year);
      const count = this.workingDaysInYear(year);
      emptyYears = count === 0 ? emptyYears + 1 : 0;
      if (index < offset) {
        year -= 1;
        continue;
      }
      if (index >= offset + count) {
        year += 1;
        continue;
      }
      return this.dayWithinYear(year, index - offset);
    }
    throw new CalendarHasNoWorkingTimeError(this.id, index);
  }

  /**
   * @param {number} year
   * @param {number} localIndex
   * @returns {number}
   */
  dayWithinYear(year, localIndex) {
    const { start, cumulative } = this.yearTable(year);
    let low = 0;
    let high = cumulative.length - 2;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle + 1] > localIndex) high = middle;
      else low = middle + 1;
    }
    return start + low;
  }

  /**
   * The n-th working day after `date` (n > 0) or before it (n < 0).
   * With n = 0 the date is returned unchanged, even when it is not a working
   * day; use {@link Calendar#nextWorkingDay} or {@link Calendar#previousWorkingDay}
   * to snap. For a working `start`, the inclusive finish of a task of
   * `duration` days is `addWorkingDays(start, duration - 1)`.
   * @template {string|number} T
   * @param {T} date
   * @param {number} count
   * @returns {T}
   */
  addWorkingDays(date, count) {
    if (count === 0) return date;
    const day = asDay(date);
    const base = this.indexOf(day);
    const startsOnWorkingDay = this.isWorkingDayNumber(day);
    const target = count > 0 && !startsOnWorkingDay ? base + count - 1 : base + count;
    return /** @type {T} */ (this.convert(date, this.dayAt(target)));
  }

  /**
   * Number of working days from `start` to `finish`, both inclusive.
   * Returns 0 or a negative number when `finish` is before `start`.
   * @param {string|number} start
   * @param {string|number} finish
   * @returns {number}
   */
  workingDaysBetween(start, finish) {
    return this.indexOf(asDay(finish) + 1) - this.indexOf(asDay(start));
  }

  /**
   * The first working day on or after `date`.
   * @template {string|number} T
   * @param {T} date
   * @returns {T}
   */
  nextWorkingDay(date) {
    return /** @type {T} */ (this.convert(date, this.dayAt(this.indexOf(asDay(date)))));
  }

  /**
   * The last working day on or before `date`.
   * @template {string|number} T
   * @param {T} date
   * @returns {T}
   */
  previousWorkingDay(date) {
    const day = asDay(date);
    if (this.isWorkingDayNumber(day)) return date;
    return /** @type {T} */ (this.convert(date, this.dayAt(this.indexOf(day) - 1)));
  }

  /**
   * @param {string|number} original
   * @param {number} day
   * @returns {string|number}
   */
  convert(original, day) {
    return typeof original === "string" ? toISO(day) : day;
  }
}

/**
 * Maps the gov.uk `bank-holidays.json` feed (one division) onto calendar exceptions.
 *
 * @example
 * const feed = await (await fetch("https://www.gov.uk/bank-holidays.json")).json();
 * const nonWorking = fromGovUkBankHolidays(feed, "england-and-wales");
 *
 * @param {{[division: string]: {events: {title: string, date: string}[]}}} feed
 * @param {string} division "england-and-wales" | "scotland" | "northern-ireland"
 * @returns {CalendarException[]}
 */
export function fromGovUkBankHolidays(feed, division) {
  const events = feed?.[division]?.events ?? [];
  return events.map((event) => ({ date: event.date, name: event.title, kind: "bank-holiday" }));
}
