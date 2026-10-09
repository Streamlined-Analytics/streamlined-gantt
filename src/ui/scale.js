// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { addDays, addMonths, startOfMonth, startOfWeek, toYMD } from "../engine/dates.js";
import { formatDate, formatLongDate } from "../engine/format.js";

/**
 * The time scale: zoom levels, the visible date range, day-to-pixel mapping
 * and the two header tiers. Pure arithmetic on day numbers; no DOM.
 *
 * @module ui/scale
 */

/**
 * @typedef {"day"|"week"|"month"|"quarter"} ZoomLevel
 */

/**
 * @typedef {object} Tick
 * @property {number} day first day of the tick
 * @property {number} x left edge in pixels
 * @property {number} width
 * @property {string} label
 * @property {string} [title] longer label for tooltips and screen readers
 */

/** @type {Record<ZoomLevel, {dayWidth: number, top: string, bottom: string, padDays: number}>} */
export const ZOOM_LEVELS = {
  day: { dayWidth: 32, top: "week", bottom: "day", padDays: 14 },
  week: { dayWidth: 12, top: "month", bottom: "week", padDays: 28 },
  month: { dayWidth: 3.2, top: "year", bottom: "month", padDays: 62 },
  quarter: { dayWidth: 1.2, top: "year", bottom: "quarter", padDays: 120 },
};

export const ZOOM_ORDER = /** @type {ZoomLevel[]} */ (["day", "week", "month", "quarter"]);

/**
 * The zoom whose header tiers suit a day width (for fit-to-width scales).
 * @param {number} dayWidth
 * @returns {ZoomLevel}
 */
export function zoomForDayWidth(dayWidth) {
  return ZOOM_ORDER.find((level) => dayWidth >= ZOOM_LEVELS[level].dayWidth * 0.75) ?? "quarter";
}

/**
 * @param {number} day
 * @param {string} unit
 * @returns {number}
 */
function unitStart(day, unit) {
  if (unit === "day") return day;
  if (unit === "week") return startOfWeek(day);
  if (unit === "month") return startOfMonth(day);
  const { month } = toYMD(day);
  if (unit === "quarter") return addMonths(day, -((month - 1) % 3));
  return addMonths(day, -(month - 1));
}

/**
 * @param {number} day
 * @param {string} unit
 * @returns {number}
 */
function nextUnit(day, unit) {
  if (unit === "day") return addDays(day, 1);
  if (unit === "week") return addDays(day, 7);
  if (unit === "month") return addMonths(day, 1);
  if (unit === "quarter") return addMonths(day, 3);
  return addMonths(day, 12);
}

export class TimeScale {
  /**
   * With `lead` the range is exact: it starts `lead` days before `start` and
   * ends `trail` days after `finish`, without rounding to whole weeks or months.
   * @param {{zoom?: ZoomLevel, start: number, finish: number, locale?: string, strings?: Record<string, string>, dayWidth?: number, padDays?: number, lead?: number, trail?: number}} options
   */
  constructor(options) {
    this.zoom = options.zoom ?? "week";
    this.config = ZOOM_LEVELS[this.zoom] ?? ZOOM_LEVELS.week;
    this.dayWidth = options.dayWidth ?? this.config.dayWidth;
    this.locale = options.locale ?? "en-GB";
    this.strings = options.strings ?? {};
    const pad = options.padDays ?? this.config.padDays;
    if (options.lead !== undefined) {
      this.start = options.start - options.lead;
      this.end = options.finish + 1 + (options.trail ?? pad);
      return;
    }
    this.start = unitStart(options.start - pad, this.config.top === "year" ? "month" : "week");
    const paddedFinish = options.finish + pad;
    let end = unitStart(paddedFinish, this.config.bottom);
    while (end <= paddedFinish) end = nextUnit(end, this.config.bottom);
    this.end = end;
  }

  /** Total width in pixels. */
  get width() {
    return (this.end - this.start) * this.dayWidth;
  }

  /**
   * Left edge of a day.
   * @param {number} day
   * @returns {number}
   */
  x(day) {
    return (day - this.start) * this.dayWidth;
  }

  /**
   * The day under a pixel position.
   * @param {number} x
   * @returns {number}
   */
  dayAt(x) {
    return this.start + Math.floor(x / this.dayWidth);
  }

  /**
   * @param {number} day
   * @returns {boolean}
   */
  contains(day) {
    return day >= this.start && day < this.end;
  }

  /**
   * Header ticks for one tier, limited to a pixel window.
   * @param {"top"|"bottom"} tier
   * @param {number} [fromX]
   * @param {number} [toX]
   * @returns {Tick[]}
   */
  ticks(tier, fromX = 0, toX = this.width) {
    const unit = this.config[tier];
    const ticks = [];
    let day = unitStart(Math.max(this.start, this.dayAt(fromX)), unit);
    const lastDay = Math.min(this.end, this.dayAt(toX) + 1);
    while (day < lastDay) {
      const next = nextUnit(day, unit);
      const left = this.x(Math.max(day, this.start));
      const right = this.x(Math.min(next, this.end));
      ticks.push({ day, x: left, width: right - left, ...this.label(day, unit) });
      day = next;
    }
    return ticks;
  }

  /**
   * @param {number} day
   * @param {string} unit
   * @returns {{label: string, title: string}}
   */
  label(day, unit) {
    const locale = this.locale;
    const long = formatLongDate(day, locale);
    const weekCommencing = this.strings.weekCommencing ?? "w/c";
    if (unit === "day") {
      const weekday = formatDate(day, locale, { weekday: "narrow" });
      return { label: `${weekday} ${toYMD(day).day}`, title: long };
    }
    if (unit === "week") {
      const short = formatDate(day, locale, { day: "numeric", month: "short" });
      const withYear =
        this.zoom === "day"
          ? formatDate(day, locale, { day: "numeric", month: "short", year: "numeric" })
          : short;
      return { label: `${weekCommencing} ${withYear}`, title: `${weekCommencing} ${long}` };
    }
    if (unit === "month") {
      const format =
        this.config.top === "month" ? { month: "long", year: "numeric" } : { month: "short" };
      return {
        label: formatDate(day, locale, /** @type {Intl.DateTimeFormatOptions} */ (format)),
        title: formatDate(day, locale, { month: "long", year: "numeric" }),
      };
    }
    if (unit === "quarter") {
      const { year, month } = toYMD(day);
      const quarter = `${this.strings.quarterPrefix ?? "Q"}${Math.floor((month - 1) / 3) + 1}`;
      return { label: quarter, title: `${quarter} ${year}` };
    }
    const { year } = toYMD(day);
    return { label: String(year), title: String(year) };
  }
}
