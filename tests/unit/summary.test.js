// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import { FieldRegistry, analyse, projectSummary, splitEvenly } from "../../src/engine/index.js";
import { loadFixture } from "../support/builders.js";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";
import { lazy } from "../support/lazy.js";

const programme = loadFixture("programmes/flat-roof.json");
const analysis = lazy(() => analyse(programme, { fields: new FieldRegistry(FLAT_ROOF_FIELDS) }));

describe("getProjectSummary on the flat-roof job (hand-computed)", () => {
  const summary = lazy(() =>
    projectSummary(analysis, programme, {
      bucket: "week",
      baseline: programme.baselines[0],
    }),
  );

  test("dates, durations and float", () => {
    expect(summary).toMatchObject({
      start: "2026-11-02",
      finish: "2026-11-27",
      workingDays: 20,
      calendarDays: 26,
      plannedCompletion: "2026-11-27",
      contractCompletion: "2026-12-04",
      terminalFloat: 5,
      taskCount: 10,
      criticalCount: 0,
    });
  });

  test("progress is duration-weighted: (3 x 1 + 3 x 0.6) / 20", () => {
    expect(summary.progress).toBeCloseTo(0.24, 10);
  });

  test("sums and derived values are exact to the penny", () => {
    expect(summary.sums).toEqual({ cost: 1268000, charge: 1800000, qty: 258 });
    expect(summary.derived.profit).toBe(532000);
    expect(summary.derived.margin).toBeCloseTo(0.2956, 4);
  });

  test("the stage-payment schedule is sorted by date with cumulative values", () => {
    expect(summary.payments).toEqual([
      {
        taskId: "p1",
        name: "Stage payment 1: strip-out complete (30%)",
        date: "2026-11-12",
        value: 540000,
        cumulative: 540000,
        percentOfTotal: 0.3,
        cumulativePercent: 0.3,
      },
      {
        taskId: "p2",
        name: "Stage payment 2: watertight (50%)",
        date: "2026-11-25",
        value: 900000,
        cumulative: 1440000,
        percentOfTotal: 0.5,
        cumulativePercent: 0.8,
      },
      {
        taskId: "p3",
        name: "Final payment on handover (20%)",
        date: "2026-11-27",
        value: 360000,
        cumulative: 1800000,
        percentOfTotal: 0.2,
        cumulativePercent: 1,
      },
    ]);
  });

  test("baseline variance in working days", () => {
    expect(summary.baseline).toEqual({
      id: "bl1",
      name: "Rev A tender",
      finish: "2026-11-26",
      varianceWorkingDays: 1,
    });
  });

  test("weekly series spread linearly over working days", () => {
    expect(summary.series).toEqual({
      buckets: ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"],
      cost: [232000, 266000, 500000, 270000],
      costCumulative: [232000, 498000, 998000, 1268000],
      charge: [340000, 380000, 750000, 330000],
      chargeCumulative: [340000, 720000, 1470000, 1800000],
      qty: [80, 78, 100, 0],
      qtyCumulative: [80, 158, 258, 258],
      payments: [0, 540000, 0, 1260000],
      paymentsCumulative: [0, 540000, 540000, 1800000],
    });
  });
});

describe("summary options", () => {
  test("monthly buckets, start and finish spreads", () => {
    const monthly = projectSummary(analysis, programme, { bucket: "month", fields: ["cost"] });
    expect(monthly.series.buckets).toEqual(["2026-11-01"]);
    expect(monthly.series.cost).toEqual([1268000]);
    const atStart = projectSummary(analysis, programme, {
      bucket: "week",
      fields: ["cost"],
      spread: "start",
    });
    expect(atStart.series.cost).toEqual([120000 + 168000, 110000 + 600000, 0, 190000 + 80000]);
    const atFinish = projectSummary(analysis, programme, {
      bucket: "week",
      fields: ["cost"],
      spread: "finish",
    });
    expect(atFinish.series.cost).toEqual([120000, 168000 + 110000, 600000, 270000]);
  });

  test("filters partition the sums exactly", () => {
    const roofing = (task) => task.trade === "Roofing";
    const yes = projectSummary(analysis, programme, { filter: roofing });
    const no = projectSummary(analysis, programme, { filter: (task) => !roofing(task) });
    expect(yes.sums.cost + no.sums.cost).toBe(1268000);
    expect(yes.taskCount).toBe(4);
  });

  test("no bucket means no series; no baseline means null", () => {
    const plain = projectSummary(analysis, programme);
    expect(plain.series).toBeUndefined();
    expect(plain.baseline).toBeNull();
  });

  test("an empty programme summarises to zeros", () => {
    const empty = { tasks: [] };
    const summary = projectSummary(analyse(empty), empty, { bucket: "week" });
    expect(summary).toMatchObject({
      start: null,
      finish: null,
      workingDays: 0,
      calendarDays: 0,
      taskCount: 0,
      progress: 0,
      payments: [],
      terminalFloat: null,
    });
    expect(summary.series).toBeUndefined();
  });

  test("an empty baseline has no finish", () => {
    const summary = projectSummary(analysis, programme, { baseline: { id: "b0", tasks: {} } });
    expect(summary.baseline).toEqual({
      id: "b0",
      name: undefined,
      finish: null,
      varianceWorkingDays: null,
    });
  });

  test("payments without values count as zero", () => {
    const data = { tasks: [{ id: "p", name: "P", type: "payment", start: "2026-11-02" }] };
    expect(projectSummary(analyse(data), data).payments[0]).toMatchObject({
      value: 0,
      percentOfTotal: 0,
      cumulativePercent: 0,
    });
  });

  test("non-integer values are spread proportionally", () => {
    const data = {
      tasks: [{ id: "a", name: "A", start: "2026-11-02", duration: 4, fields: { qty: 1 } }],
    };
    const fields = new FieldRegistry([{ key: "qty", type: "number", rollup: "sum" }]);
    const fractional = { tasks: [{ ...data.tasks[0], fields: { qty: 1.5 } }] };
    expect(
      projectSummary(analyse(fractional, { fields }), fractional, { bucket: "week" }).series.qty,
    ).toEqual([1.5]);
  });
});

describe("splitEvenly", () => {
  test.each([
    [100, 3, [34, 33, 33]],
    [-100, 3, [-34, -33, -33]],
    [5, 0, []],
    [0, 2, [0, 0]],
  ])("splitEvenly(%i, %i)", (amount, count, expected) => {
    expect(splitEvenly(amount, count)).toEqual(expected);
  });
});

describe("rolled-up progress", () => {
  test("a task with an actual finish counts as complete", () => {
    const data = {
      tasks: [
        {
          id: "a",
          name: "A",
          start: "2026-11-02",
          duration: 2,
          progress: 0.5,
          actualFinish: "2026-11-03",
        },
        { id: "b", name: "B", start: "2026-11-04", duration: 2 },
      ],
      links: [],
    };
    expect(projectSummary(analyse(data), data).progress).toBeCloseTo(0.5, 10);
    expect(analyse(data).resolved.get("a").progress).toBe(1);
  });
});
