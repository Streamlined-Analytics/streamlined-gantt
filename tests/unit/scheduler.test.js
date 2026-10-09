// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import { Calendar, schedule } from "../../src/engine/index.js";
import { ewCalendar, loadFixture } from "../support/builders.js";
import { lazy } from "../support/lazy.js";

const ew = lazy(() => new Calendar(ewCalendar()));

/** Schedules a fixture and returns the result plus a compact per-task view. */
function run(programme, overrides = {}) {
  const result = schedule({
    tasks: programme.tasks,
    links: programme.links,
    calendar: new Calendar(programme.calendars?.[0] ?? { id: "default" }),
    dataDate: programme.dataDate ?? null,
    contractCompletion: programme.contractCompletion ?? null,
    mode: "propagate",
    ...overrides,
  });
  const view = Object.fromEntries([...result.tasks].map(([id, task]) => [id, task]));
  return { result, view };
}

describe("N1: classic 10-activity FS network", () => {
  const scheduled = lazy(() => run(loadFixture("programmes/cpm-n1.json")));
  const result = lazy(() => scheduled.result);
  const view = lazy(() => scheduled.view);
  const expected = {
    A: ["2026-11-02", "2026-11-04", 0, 0, true],
    B: ["2026-11-05", "2026-11-10", 1, 0, false],
    C: ["2026-11-05", "2026-11-06", 0, 0, true],
    D: ["2026-11-11", "2026-11-17", 1, 0, false],
    E: ["2026-11-09", "2026-11-11", 5, 4, false],
    F: ["2026-11-09", "2026-11-12", 0, 0, true],
    G: ["2026-11-18", "2026-11-19", 1, 1, false],
    H: ["2026-11-13", "2026-11-20", 0, 0, true],
    I: ["2026-11-23", "2026-11-25", 0, 0, true],
    J: ["2026-11-26", "2026-11-27", 0, 0, true],
  };

  test.each(Object.entries(expected))(
    "%s dates, floats and criticality",
    (id, [start, finish, totalFloat, freeFloat, critical]) => {
      expect(view[id]).toMatchObject({ start, finish, totalFloat, freeFloat, critical });
    },
  );

  test("critical path is A-C-F-H-I-J, finishing Friday 27 November after 20 working days", () => {
    expect(result.critical.sort()).toEqual(["A", "C", "F", "H", "I", "J"]);
    expect(result.projectStart).toBe("2026-11-02");
    expect(result.projectFinish).toBe("2026-11-27");
    expect(ew.workingDaysBetween(result.projectStart, result.projectFinish)).toBe(20);
    expect(result.terminalFloat).toBeNull();
  });

  test("early and late dates are reported as inclusive ISO dates", () => {
    expect(view.B).toMatchObject({
      earlyStart: "2026-11-05",
      earlyFinish: "2026-11-10",
      lateStart: "2026-11-06",
      lateFinish: "2026-11-11",
    });
  });

  test("every task moved from the shared start date is reported as changed; A stays put", () => {
    expect(result.changed.map((change) => change.id).sort()).toEqual([
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
    ]);
    expect(result.changed.find((change) => change.id === "J")).toEqual({
      id: "J",
      start: "2026-11-26",
      finish: "2026-11-27",
      duration: 2,
    });
  });
});

describe("N1 with a contract completion two working days early (negative float)", () => {
  const scheduled = lazy(() => run(loadFixture("programmes/cpm-n1-deadline.json")));
  const result = lazy(() => scheduled.result);
  const view = lazy(() => scheduled.view);
  const totalFloat = { A: -2, B: -1, C: -2, D: -1, E: 3, F: -2, G: -1, H: -2, I: -2, J: -2 };
  const freeFloat = { A: 0, B: 0, C: 0, D: 0, E: 4, F: 0, G: 1, H: 0, I: 0, J: 0 };

  test.each(Object.keys(totalFloat))("%s total float and free float", (id) => {
    expect(view[id].totalFloat).toBe(totalFloat[id]);
    expect(view[id].freeFloat).toBe(freeFloat[id]);
  });

  test("free float is never negative from logic alone", () => {
    expect(Object.values(view).every((task) => task.freeFloat >= 0)).toBe(true);
  });

  test("nine tasks are critical at TF <= 0; only E is not", () => {
    expect(result.critical.sort()).toEqual(["A", "B", "C", "D", "F", "G", "H", "I", "J"]);
    expect(result.terminalFloat).toBe(-2);
  });

  test("the critical threshold is configurable", () => {
    const { result: loose } = run(loadFixture("programmes/cpm-n1-deadline.json"), {
      criticalThreshold: -2,
    });
    expect(loose.critical.sort()).toEqual(["A", "C", "F", "H", "I", "J"]);
  });
});

describe("N1 across Christmas proves floats are in working days", () => {
  const scheduled = lazy(() => run(loadFixture("programmes/cpm-n1-christmas.json")));
  const result = lazy(() => scheduled.result);
  const view = lazy(() => scheduled.view);
  const expected = {
    A: ["2026-12-14", "2026-12-16"],
    B: ["2026-12-17", "2026-12-22"],
    C: ["2026-12-17", "2026-12-18"],
    D: ["2026-12-23", "2026-12-31"],
    E: ["2026-12-21", "2026-12-23"],
    F: ["2026-12-21", "2026-12-24"],
    G: ["2027-01-04", "2027-01-05"],
    H: ["2026-12-29", "2027-01-06"],
    I: ["2027-01-07", "2027-01-11"],
    J: ["2027-01-12", "2027-01-13"],
  };

  test.each(Object.entries(expected))("%s spans the holiday cluster", (id, [start, finish]) => {
    expect(view[id]).toMatchObject({ start, finish });
  });

  test("same floats as plain N1: 20 working days over 31 calendar days", () => {
    const plain = run(loadFixture("programmes/cpm-n1.json")).view;
    for (const id of Object.keys(expected)) {
      expect(view[id].totalFloat).toBe(plain[id].totalFloat);
      expect(view[id].freeFloat).toBe(plain[id].freeFloat);
    }
    expect(ew.workingDaysBetween(result.projectStart, result.projectFinish)).toBe(20);
  });
});

describe("N2: mixed link types, lags and a lead", () => {
  const scheduled = lazy(() => run(loadFixture("programmes/cpm-n2-mixed.json")));
  const result = lazy(() => scheduled.result);
  const view = lazy(() => scheduled.view);
  const expected = {
    A: ["2026-11-02", "2026-11-05", 0, 0, true],
    B: ["2026-11-06", "2026-11-10", 1, 0, false],
    C: ["2026-11-04", "2026-11-10", 0, 0, true],
    D: ["2026-11-10", "2026-11-11", 1, 1, false],
    E: ["2026-11-10", "2026-11-12", 0, 0, true],
    F: ["2026-11-13", "2026-11-13", 0, 0, true],
  };

  test.each(Object.entries(expected))(
    "%s",
    (id, [start, finish, totalFloat, freeFloat, critical]) => {
      expect(view[id]).toMatchObject({ start, finish, totalFloat, freeFloat, critical });
    },
  );

  test("project finishes 2026-11-13 after 10 working days", () => {
    expect(result.projectFinish).toBe("2026-11-13");
  });
});

describe("scheduling modes", () => {
  const twoTasks = (startOfB) => ({
    tasks: [
      { id: "A", name: "A", start: "2026-11-02", duration: 3 },
      { id: "B", name: "B", start: startOfB, duration: 2 },
    ],
    links: [{ id: "l", from: "A", to: "B", type: "FS", lag: 0 }],
    calendars: [ewCalendar()],
  });

  test("propagate never pulls a successor back", () => {
    const { view, result } = run(twoTasks("2026-11-12"));
    expect(view.B.start).toBe("2026-11-12");
    expect(result.changed).toEqual([]);
  });

  test("tight pulls a successor back to its earliest logical start", () => {
    const { view } = run(twoTasks("2026-11-12"), { mode: "tight" });
    expect(view.B.start).toBe("2026-11-05");
  });

  test("tight keeps a task the user has just moved where it was put", () => {
    const { view } = run(twoTasks("2026-11-12"), { mode: "tight", pinned: ["B"] });
    expect(view.B.start).toBe("2026-11-12");
  });

  test("off moves nothing and reports the broken link", () => {
    const { view, result } = run(twoTasks("2026-11-03"), { mode: "off" });
    expect(view.B.start).toBe("2026-11-03");
    expect(result.changed).toEqual([]);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "link-violated", taskId: "B", linkId: "l" }),
    );
  });

  test("propagate pushes a successor that starts too early", () => {
    const { view } = run(twoTasks("2026-11-03"));
    expect(view.B).toMatchObject({ start: "2026-11-05", finish: "2026-11-06" });
  });

  test("a predecessor moved over Christmas pushes its successor past the holidays", () => {
    const { view } = run({
      tasks: [
        { id: "B", name: "B", start: "2026-12-21", finish: "2026-12-24", duration: 4 },
        { id: "C", name: "C", start: "2026-12-24", duration: 1 },
      ],
      links: [{ id: "l", from: "B", to: "C" }],
      calendars: [ewCalendar()],
    });
    expect(view.C.start).toBe("2026-12-29");
  });
});

describe("constraints", () => {
  const n1 = () => loadFixture("programmes/cpm-n1.json");

  test("SNET on H pushes H, I and J by three days", () => {
    const programme = n1();
    programme.tasks.find((task) => task.id === "H").constraint = {
      type: "SNET",
      date: "2026-11-18",
    };
    const { view } = run(programme);
    expect(view.H.start).toBe("2026-11-18");
    expect(view.I.start).toBe("2026-11-26");
    expect(view.J).toMatchObject({ start: "2026-12-01", finish: "2026-12-02" });
  });

  test("FNLT is reported as a violation, not silently fixed", () => {
    const programme = n1();
    programme.tasks.find((task) => task.id === "J").constraint = {
      type: "FNLT",
      date: "2026-11-26",
    };
    const { view, result } = run(programme);
    expect(view.J.finish).toBe("2026-11-27");
    expect(view.J.totalFloat).toBe(-1);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "constraint-breached", taskId: "J" }),
    );
  });

  test("ASAP is the default and needs no date", () => {
    const programme = n1();
    programme.tasks[0].constraint = { type: "ASAP" };
    expect(run(programme).view.A.start).toBe("2026-11-02");
  });
});

describe("progress and the data date", () => {
  test("unstarted work cannot sit before the data date; started work keeps its start", () => {
    const programme = loadFixture("programmes/cpm-n1.json");
    programme.dataDate = "2026-11-09";
    const byId = Object.fromEntries(programme.tasks.map((task) => [task.id, task]));
    Object.assign(byId.A, { start: "2026-11-02", finish: "2026-11-04", progress: 1 });
    Object.assign(byId.C, { start: "2026-11-05", progress: 0.5 });
    const { view } = run(programme);
    expect(view.A).toMatchObject({ start: "2026-11-02", finish: "2026-11-04" });
    expect(view.C).toMatchObject({ start: "2026-11-05", finish: "2026-11-09" });
    expect(view.B.start).toBe("2026-11-09");
    expect(view.E.start).toBe("2026-11-10");
    for (const id of ["B", "D", "E", "F", "G", "H", "I", "J"]) {
      expect(view[id].start >= "2026-11-09").toBe(true);
    }
  });

  test("actual dates win over planned dates for complete tasks", () => {
    const { view } = run({
      tasks: [
        {
          id: "A",
          name: "A",
          start: "2026-11-02",
          duration: 3,
          actualStart: "2026-11-03",
          actualFinish: "2026-11-06",
        },
      ],
      links: [],
      calendars: [ewCalendar()],
    });
    expect(view.A).toMatchObject({ start: "2026-11-02", finish: "2026-11-04" });
    expect(view.A.earlyStart).toBe("2026-11-03");
    expect(view.A.earlyFinish).toBe("2026-11-06");
    expect(view.A.critical).toBe(false);
  });

  test("float of a started task uses its effective span when the data date extends it", () => {
    const { view } = run({
      dataDate: "2026-11-10",
      tasks: [
        { id: "A", name: "A", start: "2026-11-02", duration: 3, progress: 0.5 },
        { id: "B", name: "B", start: "2026-11-02", duration: 10, progress: 0.1 },
      ],
      links: [],
      calendars: [ewCalendar()],
    });
    expect(view.A).toMatchObject({ start: "2026-11-02", finish: "2026-11-10", duration: 3 });
    expect(view.B.finish).toBe("2026-11-20");
    expect(view.A.totalFloat).toBe(8);
    expect(view.A.lateStart).toBe("2026-11-12");
    expect(view.A.lateFinish).toBe("2026-11-20");
  });

  test("rescheduling a started task extended by the data date reaches a fixed point", () => {
    const programme = {
      dataDate: "2026-11-10",
      tasks: [
        { id: "A", name: "A", start: "2026-11-02", duration: 3, progress: 0.5 },
        { id: "B", name: "B", start: "2026-11-05", duration: 2 },
      ],
      links: [{ id: "l", from: "A", to: "B" }],
      calendars: [ewCalendar()],
    };
    const first = run(programme).result;
    expect(first.changed.find((change) => change.id === "A")).toEqual({
      id: "A",
      start: "2026-11-02",
      finish: "2026-11-10",
      duration: 3,
    });
    const updated = {
      ...programme,
      tasks: programme.tasks.map((task) => ({
        ...task,
        ...first.changed.find((change) => change.id === task.id),
      })),
    };
    const second = run(updated).result;
    expect(second.changed).toEqual([]);
    expect(second.tasks.get("A")).toMatchObject({ finish: "2026-11-10", duration: 3 });
    expect(second.tasks.get("B").start).toBe("2026-11-11");
  });

  test("an actual start without progress counts as started", () => {
    const { view } = run({
      dataDate: "2026-11-10",
      tasks: [{ id: "A", name: "A", start: "2026-11-02", duration: 3, actualStart: "2026-11-02" }],
      links: [],
      calendars: [ewCalendar()],
    });
    expect(view.A).toMatchObject({ start: "2026-11-02", finish: "2026-11-12" });
  });

  test("in off mode, a finish-anchored milestone the day before the data date is a violation", () => {
    const { result } = run(
      {
        dataDate: "2026-11-09",
        tasks: [
          { id: "A", name: "A", start: "2026-11-02", duration: 1, progress: 1 },
          { id: "M", name: "M", type: "milestone", start: "2026-11-06" },
        ],
        links: [{ id: "l", from: "A", to: "M" }],
        calendars: [ewCalendar()],
      },
      { mode: "off" },
    );
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "before-data-date", taskId: "M" }),
    );
  });

  test("in off mode, unstarted work before the data date is a violation", () => {
    const { result } = run(
      {
        dataDate: "2026-11-09",
        tasks: [{ id: "A", name: "A", start: "2026-11-02", duration: 3 }],
        links: [],
        calendars: [ewCalendar()],
      },
      { mode: "off" },
    );
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "before-data-date", taskId: "A" }),
    );
  });
});

describe("milestones", () => {
  const programme = (links, extra = []) => ({
    tasks: [
      { id: "S", name: "Start on site", type: "milestone", start: "2026-11-02", duration: 0 },
      { id: "A", name: "A", start: "2026-11-02", duration: 3 },
      { id: "P", name: "Stage payment", type: "payment", start: "2026-11-02", value: 540000 },
      { id: "B", name: "B", start: "2026-11-02", duration: 2 },
      ...extra,
    ],
    links,
    calendars: [ewCalendar()],
  });

  test("a start milestone sits at the start of its date; its FS successor starts the same day", () => {
    const { view } = run(programme([{ id: "l1", from: "S", to: "A" }]));
    expect(view.S).toMatchObject({ start: "2026-11-02", finish: "2026-11-02", duration: 0 });
    expect(view.A.start).toBe("2026-11-02");
  });

  test("a milestone after a task takes the task's finish date; its successor starts the next working day", () => {
    const { view } = run(
      programme([
        { id: "l1", from: "A", to: "P" },
        { id: "l2", from: "P", to: "B" },
      ]),
    );
    expect(view.P).toMatchObject({ start: "2026-11-04", finish: "2026-11-04", duration: 0 });
    expect(view.P.earlyStart).toBe("2026-11-04");
    expect(view.P.lateFinish).toBe("2026-11-04");
    expect(view.B.start).toBe("2026-11-05");
  });

  test("a milestone driven by SS sits at its predecessor's start", () => {
    const { view } = run(programme([{ id: "l1", from: "A", to: "P", type: "SS", lag: 1 }]));
    expect(view.P.start).toBe("2026-11-03");
  });

  test("a finish-anchored milestone respects SNET and the data date on its own date", () => {
    const base = (extra) => ({
      tasks: [
        { id: "A", name: "A", start: "2026-11-02", duration: 1 },
        { id: "M", name: "M", type: "milestone", start: "2026-11-02", ...extra },
      ],
      links: [{ id: "l", from: "A", to: "M" }],
      calendars: [ewCalendar()],
    });
    expect(run(base({ constraint: { type: "SNET", date: "2026-11-05" } })).view.M.start).toBe(
      "2026-11-05",
    );
    expect(run({ ...base({}), dataDate: "2026-11-06" }).view.M.start).toBe("2026-11-06");
  });

  test("a finish milestone on a non-working day reports the previous working day", () => {
    const { view } = run({
      tasks: [
        { id: "A", name: "A", start: "2026-12-21", duration: 4 },
        { id: "M", name: "M", type: "milestone", start: "2026-12-25" },
      ],
      links: [{ id: "l", from: "A", to: "M" }],
      calendars: [ewCalendar()],
    });
    expect(view.M.start).toBe("2026-12-24");
  });
});

describe("locked tasks, summaries and violations", () => {
  test("locked and reference tasks never move and report the conflict", () => {
    const { view, result } = run({
      tasks: [
        { id: "A", name: "A", start: "2026-11-02", duration: 5 },
        { id: "R", name: "MC access", type: "access", locked: true, start: "2026-11-04" },
        { id: "M", name: "MC slab", type: "reference", start: "2026-11-03", duration: 2 },
      ],
      links: [
        { id: "l1", from: "A", to: "R" },
        { id: "l2", from: "A", to: "M" },
      ],
      calendars: [ewCalendar()],
    });
    expect(view.R.start).toBe("2026-11-04");
    expect(view.M.start).toBe("2026-11-03");
    expect(result.changed).toEqual([]);
    expect(
      result.violations
        .filter((violation) => violation.code === "locked-task-driven")
        .map((violation) => violation.taskId)
        .sort(),
    ).toEqual(["M", "R"]);
  });

  test("links to and from summaries apply to every leaf beneath them", () => {
    const { view } = run({
      tasks: [
        { id: "S1", name: "Phase 1", type: "summary" },
        { id: "a", name: "a", parent: "S1", start: "2026-11-02", duration: 2 },
        { id: "b", name: "b", parent: "S1", start: "2026-11-02", duration: 4 },
        { id: "S2", name: "Phase 2", type: "summary" },
        { id: "c", name: "c", parent: "S2", start: "2026-11-02", duration: 1 },
        { id: "d", name: "d", parent: "S2", start: "2026-11-02", duration: 1 },
      ],
      links: [{ id: "l", from: "S1", to: "S2" }],
      calendars: [ewCalendar()],
    });
    expect(view.c.start).toBe("2026-11-06");
    expect(view.d.start).toBe("2026-11-06");
    expect(view.S1).toBeUndefined();
  });

  test("an SS link from a summary follows the summary's start, not its latest leaf", () => {
    const { view } = run({
      tasks: [
        { id: "S1", name: "Phase 1", type: "summary" },
        { id: "a", name: "a", parent: "S1", start: "2026-11-02", duration: 2 },
        { id: "b", name: "b", parent: "S1", start: "2026-11-09", duration: 2 },
        { id: "c", name: "c", start: "2026-11-02", duration: 1 },
      ],
      links: [{ id: "l", from: "S1", to: "c", type: "SS", lag: 1 }],
      calendars: [ewCalendar()],
    });
    expect(view.c.start).toBe("2026-11-03");
  });

  test("tasks on non-working days are reported", () => {
    const { result } = run(
      {
        tasks: [{ id: "A", name: "A", start: "2026-12-25", finish: "2026-12-29" }],
        links: [],
        calendars: [ewCalendar()],
      },
      { mode: "off" },
    );
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "non-working-day", taskId: "A" }),
    );
  });

  test("an overdue need-by date is reported against the data date or today", () => {
    const programme = {
      tasks: [{ id: "N", name: "Drawings needed", type: "need-by", start: "2026-11-05" }],
      links: [],
      calendars: [ewCalendar()],
    };
    expect(run({ ...programme, dataDate: "2026-11-09" }).result.violations).toContainEqual(
      expect.objectContaining({ code: "need-by-overdue" }),
    );
    expect(run(programme, { today: "2026-11-10" }).result.violations).toContainEqual(
      expect.objectContaining({ code: "need-by-overdue" }),
    );
    expect(run(programme, { today: "2026-11-01" }).result.violations).toEqual([]);
    programme.tasks[0].actualFinish = "2026-11-04";
    expect(run(programme, { today: "2026-11-10" }).result.violations).toEqual([]);
  });

  test("a need-by date keeps its date and reports when logic makes it late", () => {
    const { view, result } = run({
      tasks: [
        { id: "A", name: "Design", start: "2026-11-02", duration: 5 },
        { id: "N", name: "Drawings needed", type: "need-by", start: "2026-11-04" },
      ],
      links: [{ id: "l", from: "A", to: "N" }],
      calendars: [ewCalendar()],
    });
    expect(view.N.start).toBe("2026-11-04");
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "need-by-late", taskId: "N" }),
    );
  });

  test("a dependency cycle throws", () => {
    expect(() =>
      run({
        tasks: [
          { id: "A", name: "A", start: "2026-11-02", duration: 1 },
          { id: "B", name: "B", start: "2026-11-02", duration: 1 },
        ],
        links: [
          { id: "1", from: "A", to: "B" },
          { id: "2", from: "B", to: "A" },
        ],
        calendars: [ewCalendar()],
      }),
    ).toThrow(/cycle/);
  });

  test("an empty programme schedules to nothing", () => {
    const { result } = run({ tasks: [], links: [], calendars: [ewCalendar()] });
    expect(result).toMatchObject({
      projectStart: null,
      projectFinish: null,
      critical: [],
      changed: [],
    });
  });

  test("a task stored with only a finish date resolves its duration from the calendar", () => {
    const { view } = run({
      tasks: [{ id: "A", name: "A", start: "2026-12-23", finish: "2026-12-29" }],
      links: [],
      calendars: [ewCalendar()],
    });
    expect(view.A.duration).toBe(3);
  });
});
