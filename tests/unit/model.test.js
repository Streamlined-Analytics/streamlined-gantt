// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  Calendar,
  analyse,
  isComplete,
  isLocked,
  isMilestone,
  isStarted,
  normaliseDatePatch,
  resolveLeafDates,
  schedulingCalendar,
} from "../../src/engine/index.js";
import { leafTasks } from "../../src/engine/analysis.js";
import { ewCalendar, loadFixture } from "../support/builders.js";
import { lazy } from "../support/lazy.js";

const ew = lazy(() => new Calendar(ewCalendar()));

describe("task predicates", () => {
  test("milestones, locks and progress", () => {
    expect(isMilestone({ type: "payment" })).toBe(true);
    expect(isMilestone({ type: "task", duration: 0 })).toBe(true);
    expect(isMilestone({ type: "summary", duration: 0 })).toBe(false);
    expect(isMilestone({ duration: 2 })).toBe(false);
    expect(isLocked({ type: "reference" })).toBe(true);
    expect(isLocked({ locked: true })).toBe(true);
    expect(isLocked({ locked: false })).toBe(false);
    expect(isComplete({ progress: 1 })).toBe(true);
    expect(isComplete({ actualFinish: "2026-11-02" })).toBe(true);
    expect(isComplete({})).toBe(false);
    expect(isStarted({ actualStart: "2026-11-02" })).toBe(true);
    expect(isStarted({ progress: 0 })).toBe(false);
  });
});

describe("resolving and normalising dates (inclusive finish)", () => {
  test("finish wins over duration; duration derives finish; milestones are points", () => {
    expect(
      resolveLeafDates({ id: "a", name: "a", start: "2026-12-23", finish: "2026-12-29" }, ew),
    ).toMatchObject({ duration: 3, milestone: false });
    const derived = resolveLeafDates({ id: "a", name: "a", start: "2026-12-23", duration: 3 }, ew);
    expect(ew.convert("x", derived.finish)).toBe("2026-12-29");
    expect(
      resolveLeafDates(
        { id: "m", name: "m", type: "milestone", start: "2026-12-23", finish: "2026-12-29" },
        ew,
      ),
    ).toMatchObject({ duration: 0, milestone: true });
    const fromWeekend = resolveLeafDates(
      { id: "a", name: "a", start: "2026-12-26", duration: 1 },
      ew,
    );
    expect(ew.convert("x", fromWeekend.finish)).toBe("2026-12-29");
    expect(resolveLeafDates({ id: "a", name: "a", start: "2026-11-02" }, ew).duration).toBe(1);
  });

  const task = { id: "a", name: "a", start: "2026-12-21", finish: "2026-12-23", duration: 3 };

  test.each([
    [
      { start: "2026-12-23" },
      { start: "2026-12-23", finish: "2026-12-29", duration: 3 },
      "move keeps the duration",
    ],
    [
      { finish: "2026-12-29" },
      { start: "2026-12-21", finish: "2026-12-29", duration: 5 },
      "resize the end",
    ],
    [
      { start: "2026-12-17", finish: "2026-12-23" },
      { start: "2026-12-17", finish: "2026-12-23", duration: 5 },
      "resize the start",
    ],
    [
      { duration: 1 },
      { start: "2026-12-21", finish: "2026-12-21", duration: 1 },
      "set the duration",
    ],
    [
      { duration: 0 },
      { start: "2026-12-21", finish: "2026-12-21", duration: 0 },
      "duration 0 makes a milestone",
    ],
    [
      { start: "2026-12-25" },
      { start: "2026-12-29", finish: "2026-12-31", duration: 3 },
      "a start on a holiday snaps forward",
    ],
    [
      { finish: "2026-12-14" },
      { start: "2026-12-21", finish: "2026-12-21", duration: 1 },
      "a finish before the start clamps to one day",
    ],
  ])("%j → %j (%s)", (patch, expected) => {
    expect(normaliseDatePatch(task, patch, ew)).toEqual(expected);
  });

  test("milestones keep start = finish", () => {
    const milestone = {
      id: "m",
      name: "m",
      type: "milestone",
      start: "2026-11-04",
      finish: "2026-11-04",
      duration: 0,
    };
    expect(normaliseDatePatch(milestone, { start: "2026-11-06" }, ew)).toEqual({
      start: "2026-11-06",
      finish: "2026-11-06",
      duration: 0,
    });
    expect(normaliseDatePatch(milestone, { finish: "2026-11-09" }, ew)).toEqual({
      start: "2026-11-09",
      finish: "2026-11-09",
      duration: 0,
    });
  });
});

describe("analysis", () => {
  test("uses the default calendar, else the first, else Monday-Friday", () => {
    expect(
      schedulingCalendar({ tasks: [], defaultCalendar: "b", calendars: [{ id: "a" }, { id: "b" }] })
        .id,
    ).toBe("b");
    expect(schedulingCalendar({ tasks: [], calendars: [{ id: "a" }] }).id).toBe("a");
    expect(schedulingCalendar({ tasks: [] }).id).toBe("default");
  });

  test("rolls up summaries, depth and order", () => {
    const programme = loadFixture("programmes/flat-roof.json");
    const analysis = analyse(programme);
    expect(analysis.order.slice(0, 4)).toEqual(["s1", "a1", "t1", "s2"]);
    expect(analysis.depth.get("s2")).toBe(1);
    expect(analysis.depth.get("t5")).toBe(2);
    const s2 = analysis.resolved.get("s2");
    expect(ew.convert("x", s2.start)).toBe("2026-11-05");
    expect(ew.convert("x", s2.finish)).toBe("2026-11-25");
    expect(s2).toMatchObject({ summary: true, duration: 15 });
    expect(s2.progress).toBeCloseTo((3 * 0.6) / 15);
    expect(leafTasks(analysis).map((task) => task.id)).not.toContain("s1");
  });

  test("an empty summary uses its own dates when it has them", () => {
    const programme = {
      tasks: [
        {
          id: "e",
          name: "Empty",
          type: "summary",
          start: "2026-11-02",
          finish: "2026-11-06",
          progress: 0.5,
        },
        { id: "f", name: "Bare", type: "summary", start: "2026-11-02" },
        { id: "g", name: "No dates", type: "summary" },
      ],
    };
    const analysis = analyse(programme);
    expect(analysis.resolved.get("e")).toMatchObject({ duration: 5, progress: 0.5, summary: true });
    expect(analysis.resolved.get("f")).toMatchObject({ duration: 1, progress: 0 });
    expect(analysis.resolved.has("g")).toBe(false);
  });

  test("summary progress falls back to a plain mean when every leaf is a milestone", () => {
    const programme = {
      tasks: [
        { id: "s", name: "S", type: "summary" },
        { id: "m1", name: "m1", parent: "s", type: "milestone", start: "2026-11-02", progress: 1 },
        { id: "m2", name: "m2", parent: "s", type: "milestone", start: "2026-11-03" },
      ],
    };
    expect(analyse(programme).resolved.get("s").progress).toBe(0.5);
  });
});
