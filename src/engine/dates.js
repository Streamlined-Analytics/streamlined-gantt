// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Date-only arithmetic on integer day numbers.
 *
 * A day number counts calendar days since 1970-01-01 (day 0). Conversions use
 * Howard Hinnant's civil-calendar algorithms, so no `Date` object, time of day
 * or time zone is ever involved and daylight-saving changes cannot shift a
 * date. ISO `YYYY-MM-DD` strings are used only at the public boundary.
 *
 * @module engine/dates
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * @param {number} year
 * @returns {boolean}
 */
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * @param {number} year
 * @param {number} month 1-12
 * @returns {number}
 */
export function daysInMonth(year, month) {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

/**
 * Day number of a proleptic Gregorian calendar date.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @returns {number}
 */
export function fromYMD(year, month, day) {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * Calendar date of a day number.
 * @param {number} dayNumber
 * @returns {{year: number, month: number, day: number}}
 */
export function toYMD(dayNumber) {
  const shifted = dayNumber + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1;
  const month = monthPart < 10 ? monthPart + 3 : monthPart - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/**
 * True when the value is a real calendar date in `YYYY-MM-DD` form.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isISODate(value) {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(Number(match[1]), month);
}

/**
 * Parses an ISO date string to a day number.
 * @param {string} iso `YYYY-MM-DD`
 * @returns {number}
 * @throws {RangeError} when the string is not a valid calendar date
 */
export function toDay(iso) {
  if (!isISODate(iso)) throw new RangeError(`Not an ISO calendar date: ${JSON.stringify(iso)}`);
  return fromYMD(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
}

/**
 * Formats a day number as an ISO date string.
 * @param {number} dayNumber
 * @returns {string}
 */
export function toISO(dayNumber) {
  const { year, month, day } = toYMD(dayNumber);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * @param {number} dayNumber
 * @param {number} count
 * @returns {number}
 */
export function addDays(dayNumber, count) {
  return dayNumber + count;
}

/**
 * ISO weekday: 1 = Monday … 7 = Sunday.
 * @param {number} dayNumber
 * @returns {number}
 */
export function isoWeekday(dayNumber) {
  return ((((dayNumber + 3) % 7) + 7) % 7) + 1;
}

/**
 * The Monday on or before the given day.
 * @param {number} dayNumber
 * @returns {number}
 */
export function startOfWeek(dayNumber) {
  return dayNumber - (isoWeekday(dayNumber) - 1);
}

/**
 * The first day of the month containing the given day.
 * @param {number} dayNumber
 * @returns {number}
 */
export function startOfMonth(dayNumber) {
  const { year, month } = toYMD(dayNumber);
  return fromYMD(year, month, 1);
}

/**
 * The first day of the month `count` months after the month containing `dayNumber`.
 * @param {number} dayNumber
 * @param {number} count
 * @returns {number}
 */
export function addMonths(dayNumber, count) {
  const { year, month } = toYMD(dayNumber);
  const total = year * 12 + (month - 1) + count;
  return fromYMD(Math.floor(total / 12), (((total % 12) + 12) % 12) + 1, 1);
}

/**
 * Today's date in the viewer's local time zone, as a day number.
 * @returns {number}
 */
export function today() {
  const now = new Date();
  return fromYMD(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Accepts an ISO string or a day number and returns a day number.
 * @param {string|number} value
 * @returns {number}
 */
export function asDay(value) {
  return typeof value === "number" ? value : toDay(value);
}
