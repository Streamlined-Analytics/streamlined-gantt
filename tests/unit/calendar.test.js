// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  Calendar,
  CalendarHasNoWorkingTimeError,
  addWorkingDays,
  fromGovUkBankHolidays,
  isWorking,
  nextWorkingDay,
  previousWorkingDay,
  toDay,
  workingDaysBetween,
} from "../../src/engine/index.js";
import { ewCalendar, loadFixture } from "../support/builders.js";
import { lazy } from "../support/lazy.js";

const ew = lazy(() => new Calendar(ewCalendar()));
const sevenDay = lazy(() => new Calendar({ id: "7day", workWeek: [1, 2, 3, 4, 5, 6, 7] }));

describe("addWorkingDays known answers (England and Wales 2026-2027)", () => {
  test.each([
    [
      "2026-12-23",
      2,
      "2026-12-29",
      "spec MVP item #2: Christmas, weekend and Boxing Day substitute",
    ],
    ["2026-12-23", 1, "2026-12-24", ""],
    ["2026-12-24", 1, "2026-12-29", ""],
    ["2026-12-24", 3, "2026-12-31", ""],
    ["2026-12-31", 1, "2027-01-04", "New Year's Day and the weekend"],
    ["2026-12-29", -2, "2026-12-23", "negative crosses the cluster"],
    ["2027-01-04", -1, "2026-12-31", "year boundary backwards"],
    ["2026-04-02", 1, "2026-04-07", "Easter 2026"],
    ["2026-04-02", 2, "2026-04-08", ""],
    ["2027-03-25", 1, "2027-03-30", "Easter 2027 straddles the BST change"],
    ["2026-03-27", 1, "2026-03-30", "across BST start"],
    ["2026-10-23", 1, "2026-10-26", "across BST end, a 25-hour day"],
    ["2027-12-24", 1, "2027-12-29", "Christmas and Boxing Day both substituted"],
    ["2026-12-25", 1, "2026-12-29", "starting on a non-working day"],
  ])("addWorkingDays(%s, %i) = %s %s", (date, count, expected) => {
    expect(ew.addWorkingDays(date, count)).toBe(expected);
    expect(addWorkingDays(date, count, ew)).toBe(expected);
  });

  test("returns day numbers when given day numbers", () => {
    expect(ew.addWorkingDays(toDay("2026-12-23"), 2)).toBe(toDay("2026-12-29"));
  });

  test("adding zero returns the date unchanged, even on a non-working day (ADR-0003)", () => {
    expect(ew.addWorkingDays("2026-12-25", 0)).toBe("2026-12-25");
    expect(ew.addWorkingDays("2026-12-24", 0)).toBe("2026-12-24");
  });

  test("leap years: 2100 is not one, 2000 is", () => {
    expect(sevenDay.addWorkingDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(sevenDay.addWorkingDays("2000-02-28", 1)).toBe("2000-02-29");
  });

  test("works far before the 2000 epoch", () => {
    expect(ew.addWorkingDays("1961-10-13", 1)).toBe("1961-10-16");
    expect(ew.addWorkingDays("1961-10-16", -1)).toBe("1961-10-13");
  });
});

describe("workingDaysBetween counts both ends inclusive", () => {
  test.each([
    ["2026-12-21", "2027-01-08", 12],
    ["2026-03-23", "2026-04-10", 13],
    ["2026-10-19", "2026-10-30", 10],
    ["2026-12-24", "2026-12-29", 2],
    ["2026-11-13", "2026-11-20", 6],
  ])("workingDaysBetween(%s, %s) = %i", (start, finish, expected) => {
    expect(ew.workingDaysBetween(start, finish)).toBe(expected);
    expect(workingDaysBetween(start, finish, ew)).toBe(expected);
  });

  test("a finish before the start gives zero or a negative count", () => {
    expect(ew.workingDaysBetween("2026-11-04", "2026-11-03")).toBe(0);
    expect(ew.workingDaysBetween("2026-11-06", "2026-11-02")).toBe(-3);
  });

  test("inclusive finish identity: finish = add(start, d - 1) and d = between(start, finish)", () => {
    const finish = ew.addWorkingDays("2026-12-21", 9);
    expect(finish).toBe("2027-01-06");
    expect(ew.workingDaysBetween("2026-12-21", finish)).toBe(10);
  });
});

describe("snapping and exceptions", () => {
  test("nextWorkingDay and previousWorkingDay", () => {
    expect(ew.nextWorkingDay("2026-12-25")).toBe("2026-12-29");
    expect(nextWorkingDay("2026-12-24", ew)).toBe("2026-12-24");
    expect(ew.previousWorkingDay("2026-12-28")).toBe("2026-12-24");
    expect(previousWorkingDay("2026-12-24", ew)).toBe("2026-12-24");
    expect(ew.previousWorkingDay(toDay("2026-12-27"))).toBe(toDay("2026-12-24"));
  });

  test("a working exception overrides the weekend", () => {
    const calendar = new Calendar({
      id: "sat",
      working: [{ date: "2026-11-14", name: "Saturday working" }],
    });
    expect(calendar.isWorking("2026-11-14")).toBe(true);
    expect(isWorking("2026-11-14", calendar)).toBe(true);
    expect(calendar.isWorking("2026-11-15")).toBe(false);
    expect(calendar.addWorkingDays("2026-11-13", 1)).toBe("2026-11-14");
  });

  test("a working exception overrides a non-working entry on the same day", () => {
    const calendar = new Calendar({
      id: "x",
      nonWorking: [{ date: "2026-12-24", name: "Shutdown" }],
      working: [{ date: "2026-12-24" }],
    });
    expect(calendar.isWorking("2026-12-24")).toBe(true);
    expect(calendar.nonWorkingReason("2026-12-24")).toBeNull();
  });

  test("shutdown ranges are inclusive of both ends", () => {
    const calendar = new Calendar({
      ...ewCalendar(),
      nonWorking: [
        ...ewCalendar().nonWorking,
        { from: "2026-12-24", to: "2027-01-01", name: "Shutdown", kind: "shutdown" },
      ],
    });
    expect(calendar.addWorkingDays("2026-12-23", 1)).toBe("2027-01-04");
    expect(calendar.nonWorkingReason("2026-12-30")).toMatchObject({ kind: "shutdown" });
    expect(calendar.nonWorkingReason("2026-12-21")).toBeNull();
  });

  test("bank holidays are data: Scotland's 2026 World Cup holiday is non-working", () => {
    const scotland = new Calendar(loadFixture("calendars/scotland-2026-2027.json").calendar);
    expect(scotland.isWorking("2026-06-15")).toBe(false);
    expect(ew.isWorking("2026-06-15")).toBe(true);
    expect(scotland.addWorkingDays("2026-06-12", 1)).toBe("2026-06-16");
  });

  test("a Sunday-Thursday work week", () => {
    const calendar = new Calendar({ id: "sun-thu", workWeek: [7, 1, 2, 3, 4] });
    expect(calendar.addWorkingDays("2026-11-05", 1)).toBe("2026-11-08");
    expect(calendar.workingDaysBetween("2026-11-01", "2026-11-07")).toBe(5);
  });

  test("defaults to Monday-Friday", () => {
    const calendar = new Calendar();
    expect(calendar.id).toBe("default");
    expect(calendar.addWorkingDays("2026-11-06", 1)).toBe("2026-11-09");
    expect(addWorkingDays("2026-11-06", 1)).toBe("2026-11-09");
    expect(addWorkingDays("2026-11-06", 1, { id: "plain" })).toBe("2026-11-09");
  });
});

describe("calendars without working time", () => {
  test("throws instead of looping when every day is excluded", () => {
    const calendar = new Calendar({
      id: "none",
      workWeek: [1],
      nonWorking: [{ from: "2020-01-01", to: "2029-12-31" }],
    });
    const started = performance.now();
    expect(() => calendar.addWorkingDays("2026-11-02", 1)).toThrow(CalendarHasNoWorkingTimeError);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("the error names the calendar", () => {
    const calendar = new Calendar({ id: "empty", workWeek: [] });
    try {
      calendar.addWorkingDays("2026-11-02", 1);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarHasNoWorkingTimeError);
      expect(error.calendarId).toBe("empty");
      expect(error.message).toContain('"empty"');
    }
  });
});

describe("gov.uk feed mapping", () => {
  test("maps one division's events to non-working exceptions", () => {
    const feed = {
      "england-and-wales": { events: [{ title: "Christmas Day", date: "2026-12-25" }] },
    };
    expect(fromGovUkBankHolidays(feed, "england-and-wales")).toEqual([
      { date: "2026-12-25", name: "Christmas Day", kind: "bank-holiday" },
    ]);
    expect(fromGovUkBankHolidays(feed, "scotland")).toEqual([]);
    expect(fromGovUkBankHolidays(undefined, "scotland")).toEqual([]);
  });
});
