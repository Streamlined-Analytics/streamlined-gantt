// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONSTRAINT_TYPES,
  DELAY_KINDS,
  FieldRegistry,
  GanttValidationError,
  LINK_TYPES,
  TASK_TYPES,
  collectProblems,
  validateProgramme,
} from "../../src/engine/index.js";
import { loadProgramme, serialiseProgramme } from "../../src/model/programme.js";
import { loadFixture } from "../support/builders.js";

const minimal = () => ({ tasks: [{ id: "a", name: "A", start: "2026-11-02", duration: 1 }] });
const problemsOf = (data, options) => collectProblems(data, options).map((problem) => problem.path);

describe("load and toJSON round trip", () => {
  test.each(["spec-example.v1.json", "flat-roof.json", "cpm-n1.json", "cpm-n2-mixed.json"])(
    "%s round-trips deep-equal, including custom fields and x- extensions",
    (name) => {
      const fixture = loadFixture(`programmes/${name}`);
      const loaded = loadProgramme(fixture);
      expect(serialiseProgramme(loaded)).toEqual(fixture);
      expect(loaded).not.toBe(fixture);
      expect(loaded.tasks[0]).not.toBe(fixture.tasks[0]);
    },
  );

  test("money up to Number.MAX_SAFE_INTEGER is accepted; fractions of a penny are not", () => {
    const data = minimal();
    data.tasks[0].value = Number.MAX_SAFE_INTEGER;
    expect(() => validateProgramme(data)).not.toThrow();
    data.tasks[0].value = 900000.5;
    expect(problemsOf(data)).toEqual(["/tasks/0/value"]);
  });
});

describe("validation errors list every problem with JSON Pointer paths", () => {
  test("the five-error fixture reports all five, in order", () => {
    const fixture = loadFixture("programmes/invalid-five-errors.json");
    try {
      validateProgramme(fixture);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GanttValidationError);
      expect(error.name).toBe("GanttValidationError");
      expect(error.problems.map((problem) => problem.path)).toEqual([
        "/tasks/3/id",
        "/tasks/1/progress",
        "/tasks/2/finish",
        "/links/0/to",
        "/links/0/type",
      ]);
      expect(error.message).toContain("/tasks/3/id");
    }
  });

  test("the message summarises the first five problems and counts the rest", () => {
    const data = {
      tasks: Array.from({ length: 7 }, (_, index) => ({
        id: `t${index}`,
        name: 1,
        start: "2026-11-02",
        duration: 1,
      })),
    };
    expect(() => validateProgramme(data)).toThrow(/and 2 more/);
  });

  test.each([
    [null, [""]],
    [[], [""]],
    [{}, ["/tasks"]],
    [{ tasks: [], links: {} }, ["/links"]],
    [{ tasks: [], calendars: {} }, ["/calendars"]],
    [{ tasks: [], schema: "streamlined-gantt/2" }, ["/schema"]],
    [{ tasks: [], dataDate: "09/11/2026" }, ["/dataDate"]],
    [{ tasks: [], mystery: true }, ["/mystery"]],
    [{ tasks: [], "x-anything": { ok: true } }, []],
    [{ tasks: [], defaultCalendar: "nope" }, ["/defaultCalendar"]],
    [{ tasks: [], baselines: {}, markers: "x" }, ["/baselines", "/markers"]],
  ])("programme-level shape %#", (data, expected) => {
    expect(problemsOf(data)).toEqual(expected);
  });

  test.each([
    [{ id: "", name: "A", start: "2026-11-02", duration: 1 }, ["/tasks/0/id"]],
    ["not an object", ["/tasks/0/id", "/tasks/0"]],
    [{ id: "a", name: 7, start: "2026-11-02", duration: 1 }, ["/tasks/0/name"]],
    [{ id: "a", name: "A", type: "hammock", start: "2026-11-02", duration: 1 }, ["/tasks/0/type"]],
    [{ id: "a", name: "A", start: "2026-11-31", duration: 1 }, ["/tasks/0/start"]],
    [{ id: "a", name: "A", start: "2026-11-02" }, ["/tasks/0"]],
    [{ id: "a", name: "A", start: "2026-11-02", duration: 1.5 }, ["/tasks/0/duration"]],
    [
      { id: "a", name: "A", start: "2026-11-02", duration: 1, actualStart: "yesterday" },
      ["/tasks/0/actualStart"],
    ],
    [
      {
        id: "a",
        name: "A",
        start: "2026-11-02",
        duration: 1,
        constraint: { type: "MSO", date: "2026-11-02" },
      },
      ["/tasks/0/constraint/type"],
    ],
    [
      { id: "a", name: "A", start: "2026-11-02", duration: 1, constraint: { type: "SNET" } },
      ["/tasks/0/constraint/date"],
    ],
    [{ id: "a", name: "A", start: "2026-11-02", duration: 1, parent: "a" }, ["/tasks/0/parent"]],
    [
      { id: "a", name: "A", start: "2026-11-02", duration: 1, calendar: "nope" },
      ["/tasks/0/calendar"],
    ],
    [
      { id: "a", name: "A", start: "2026-11-02", duration: 1, valuePercent: 2 },
      ["/tasks/0/valuePercent"],
    ],
    [{ id: "a", name: "A", start: "2026-11-02", duration: 1, locked: "yes" }, ["/tasks/0/locked"]],
    [{ id: "a", name: "A", start: "2026-11-02", duration: 1, fields: [] }, ["/tasks/0/fields"]],
    [{ id: "a", name: "A", start: "2026-11-02", duration: 1, colour: "red" }, ["/tasks/0/colour"]],
    [{ id: "a", name: "A", type: "summary", start: "nope" }, ["/tasks/0/start"]],
  ])("task problem %#", (task, expected) => {
    expect(problemsOf({ tasks: [task] })).toEqual(expected);
  });

  test("a summary needs no dates", () => {
    expect(problemsOf({ tasks: [{ id: "s", name: "S", type: "summary" }] })).toEqual([]);
  });

  test("parent chains that loop are reported", () => {
    const tasks = [
      { id: "a", name: "A", type: "summary", parent: "b" },
      { id: "b", name: "B", type: "summary", parent: "a" },
    ];
    expect(problemsOf({ tasks })).toEqual(["/tasks/0/parent", "/tasks/1/parent"]);
  });

  test.each([
    [{ id: "l", from: "a", to: "a" }, ["/links/0"]],
    [{ id: "l", from: "a", to: "b", lag: 0.5 }, ["/links/0/lag"]],
    [{ id: "l", from: "a", to: "b", note: "x" }, ["/links/0/note"]],
    ["nope", ["/links/0/id", "/links/0"]],
  ])("link problem %#", (link, expected) => {
    const tasks = [
      { id: "a", name: "A", start: "2026-11-02", duration: 1 },
      { id: "b", name: "B", start: "2026-11-02", duration: 1 },
    ];
    expect(problemsOf({ tasks, links: [link] })).toEqual(expected);
  });

  test("dependency cycles are reported with the path", () => {
    const tasks = ["a", "b", "c"].map((id) => ({ id, name: id, start: "2026-11-02", duration: 1 }));
    const links = [
      { id: "1", from: "a", to: "b" },
      { id: "2", from: "b", to: "c" },
      { id: "3", from: "c", to: "a" },
    ];
    const [problem] = collectProblems({ tasks, links });
    expect(problem.path).toBe("/links");
    expect(problem.message).toMatch(/cycle: (a|b|c) -> .* -> \1/);
  });

  test.each([
    [{ id: "c", workWeek: [] }, ["/calendars/0/workWeek"]],
    [{ id: "c", workWeek: [0, 8] }, ["/calendars/0/workWeek"]],
    [{ id: "c", nonWorking: {} }, ["/calendars/0/nonWorking"]],
    [{ id: "c", nonWorking: ["x"] }, ["/calendars/0/nonWorking/0"]],
    [{ id: "c", nonWorking: [{ date: "2026-02-30" }] }, ["/calendars/0/nonWorking/0/date"]],
    [{ id: "c", working: [{ from: "2026-12-31", to: "2026-12-01" }] }, ["/calendars/0/working/0"]],
    ["x", ["/calendars/0/id", "/calendars/0"]],
  ])("calendar problem %#", (calendar, expected) => {
    expect(problemsOf({ tasks: [], calendars: [calendar] })).toEqual(expected);
  });

  test("secondary collections are checked", () => {
    const data = {
      tasks: [{ id: "a", name: "A", start: "2026-11-02", duration: 1 }],
      baselines: [{ id: "b", tasks: { a: { start: "2026-11-02" } } }, { id: "c" }],
      delayEvents: [
        { id: "d", from: "2026-11-03", to: "2026-11-02", kind: "aliens", taskIds: ["zz"] },
      ],
      markers: [{ id: "m", date: "soon" }],
    };
    expect(problemsOf(data)).toEqual([
      "/baselines/0/tasks/a",
      "/baselines/1/tasks",
      "/delayEvents/0",
      "/delayEvents/0/kind",
      "/delayEvents/0/taskIds",
      "/markers/0/date",
    ]);
  });

  test("keys containing dots or brackets stay single JSON Pointer segments", () => {
    const data = {
      tasks: [{ id: "t.5", name: "A", start: "2026-11-02", duration: 1, "odd.key[0]": 1 }],
      baselines: [{ id: "b", tasks: { "t.5": { start: "x", finish: "2026-11-02" } } }],
    };
    expect(problemsOf(data)).toEqual(["/tasks/0/odd.key[0]", "/baselines/0/tasks/t.5"]);
  });

  test("non-array delay task ids are reported, not thrown", () => {
    const data = {
      tasks: [],
      delayEvents: [{ id: "d", from: "2026-11-02", to: "2026-11-02", taskIds: 5 }],
    };
    expect(problemsOf(data)).toEqual(["/delayEvents/0/taskIds"]);
  });

  test("prototype-polluting keys are rejected at any depth", () => {
    const data = JSON.parse(
      '{"tasks":[{"id":"a","name":"A","start":"2026-11-02","duration":1,"fields":{"__proto__":{"polluted":true}}}]}',
    );
    expect(problemsOf(data)).toContain("/tasks/0/fields/__proto__");
    expect({}.polluted).toBeUndefined();
  });

  test("custom field values are type-checked by the field registry on load", () => {
    const fields = new FieldRegistry([{ key: "cost", type: "currency" }]);
    const data = minimal();
    data.tasks[0].fields = { cost: 12.5, other: "kept" };
    expect(() => loadProgramme(data, { fields })).toThrow(GanttValidationError);
    data.tasks[0].fields.cost = 1250;
    expect(loadProgramme(data, { fields }).tasks[0].fields).toEqual({ cost: 1250, other: "kept" });
  });
});

describe("published JSON Schema", () => {
  const schema = JSON.parse(
    readFileSync(new URL("../../schema/programme.v1.json", import.meta.url), "utf8"),
  );

  test("is a 2020-12 schema whose enumerations match the validator", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.properties.schema.const).toBe("streamlined-gantt/1");
    expect(schema.$defs.task.properties.type.enum).toEqual(TASK_TYPES);
    expect(schema.$defs.link.properties.type.enum).toEqual(LINK_TYPES);
    expect(schema.$defs.constraint.properties.type.enum).toEqual(CONSTRAINT_TYPES);
    expect(schema.$defs.delayEvent.properties.kind.enum).toEqual(DELAY_KINDS);
  });

  test("durations and lags are capped, so hostile data cannot freeze the calendar", () => {
    const programme = {
      tasks: [
        { id: "a", name: "A", start: "2026-11-02", duration: 10_001 },
        { id: "b", name: "B", start: "2026-11-02", duration: 10_000 },
      ],
      links: [{ id: "l", from: "b", to: "a", lag: -10_001 }],
    };
    expect(collectProblems(programme).map((problem) => problem.path)).toEqual([
      "/tasks/0/duration",
      "/links/0/lag",
    ]);
  });
});
