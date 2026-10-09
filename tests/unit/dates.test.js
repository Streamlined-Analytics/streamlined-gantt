// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  addDays,
  addMonths,
  asDay,
  daysInMonth,
  fromYMD,
  isISODate,
  isLeapYear,
  isoWeekday,
  startOfMonth,
  startOfWeek,
  toDay,
  toISO,
  toYMD,
  today,
} from "../../src/engine/dates.js";
import { toDayNumber } from "../support/oracle-calendar.js";

describe("day numbers", () => {
  test("day 0 is 1970-01-01, a Thursday", () => {
    expect(toDay("1970-01-01")).toBe(0);
    expect(isoWeekday(0)).toBe(4);
    expect(toISO(-1)).toBe("1969-12-31");
  });

  test("ISO parse and format round-trip for every day 1900-2100 and match Date.UTC", () => {
    const first = toDay("1900-01-01");
    const last = toDay("2100-12-31");
    for (let day = first; day <= last; day += 1) {
      const iso = toISO(day);
      if (toDay(iso) !== day || toDayNumber(iso) !== day)
        throw new Error(`round trip failed at ${iso}`);
    }
    expect(last - first + 1).toBe(73_414);
  });

  test("handles years before the Gregorian era boundary arithmetic", () => {
    expect(toYMD(fromYMD(-1, 3, 1))).toEqual({ year: -1, month: 3, day: 1 });
    expect(toYMD(fromYMD(1600, 2, 29))).toEqual({ year: 1600, month: 2, day: 29 });
  });

  test("rejects invalid ISO dates", () => {
    for (const value of [
      "2026-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-1-01",
      "20261101",
      "",
      null,
      20261101,
      "2026-11-00",
    ]) {
      expect(isISODate(value)).toBe(false);
    }
    expect(isISODate("2028-02-29")).toBe(true);
    expect(() => toDay("2026-02-30")).toThrow(RangeError);
  });

  test("leap years and month lengths", () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  test("week and month helpers", () => {
    expect(toISO(startOfWeek(toDay("2026-11-08")))).toBe("2026-11-02");
    expect(toISO(startOfWeek(toDay("2026-11-02")))).toBe("2026-11-02");
    expect(toISO(startOfMonth(toDay("2026-11-27")))).toBe("2026-11-01");
    expect(toISO(addMonths(toDay("2026-11-27"), 2))).toBe("2027-01-01");
    expect(toISO(addMonths(toDay("2026-01-31"), -1))).toBe("2025-12-01");
    expect(toISO(addDays(toDay("2026-12-31"), 1))).toBe("2027-01-01");
    expect(asDay(5)).toBe(5);
    expect(asDay("1970-01-06")).toBe(5);
  });

  test("today() uses the local calendar date", () => {
    const now = new Date();
    expect(toYMD(today())).toEqual({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    });
  });
});
