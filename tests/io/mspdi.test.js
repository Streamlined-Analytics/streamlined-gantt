// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { collectProblems } from "../../src/engine/schema.js";
import { MspdiParseError, fromMSPDI, toMSPDI } from "../../src/io/mspdi.js";
import { readProgramme } from "../../src/io/mspdi-read.js";
import { child, children, parseXml, textOf } from "../../src/io/xml.js";
import { ewCalendar, loadFixture } from "../support/builders.js";
import { lazy } from "../support/lazy.js";
import {
  XML_ILLEGAL_CLASSES,
  assertWellFormedXml1,
  illegalXmlCharacters,
} from "../support/xml1.js";

const FIXTURE_DIR = new URL("../fixtures/", import.meta.url);
const foreignXml = lazy(() => ({
  text: readFileSync(new URL("mspdi/foreign-project.xml", FIXTURE_DIR), "utf8"),
}));
const foreign = lazy(() => fromMSPDI(foreignXml.text));

/** Every valid programme fixture plus the shipped example. */
const roundTripFixtures = readdirSync(new URL("programmes/", FIXTURE_DIR))
  .filter((file) => file.endsWith(".json") && !file.startsWith("invalid"))
  .map((file) => [file, () => loadFixture(`programmes/${file}`)]);
roundTripFixtures.push([
  "examples/data/flat-roof.json",
  () =>
    JSON.parse(
      readFileSync(new URL("../../examples/data/flat-roof.json", import.meta.url), "utf8"),
    ),
]);

/** The non-summary `<Task>` elements of an export, by streamlined-gantt id. */
function exportedTasks(xml) {
  const tasks = children(child(parseXml(xml), "Tasks"), "Task");
  const idOf = (task) =>
    children(task, "ExtendedAttribute").find(
      (attribute) => textOf(attribute, "FieldID") === "188743731",
    );
  return Object.fromEntries(
    tasks
      .filter((task) => textOf(task, "UID") !== "0")
      .map((task) => [textOf(idOf(task), "Value"), task]),
  );
}

const small = (overrides = {}) => ({
  schema: "streamlined-gantt/1",
  name: "Small",
  calendars: [ewCalendar()],
  tasks: [
    { id: "A", name: "Strip out", start: "2026-11-02", duration: 3 },
    { id: "B", name: "Second fix", start: "2026-11-05", duration: 2 },
    { id: "M", name: "Handover", type: "milestone", start: "2026-11-06", duration: 0 },
  ],
  links: [
    { id: "l1", from: "A", to: "B" },
    { id: "l2", from: "B", to: "M", type: "FF", lag: 0 },
  ],
  ...overrides,
});

describe("round trip", () => {
  test.each(roundTripFixtures)(
    "%s imports back deep-equal and re-exports byte-identically",
    (_name, load) => {
      const programme = load();
      const xml = toMSPDI(programme);
      const imported = fromMSPDI(xml);
      expect(imported.warnings).toEqual([]);
      expect(imported.programme).toEqual(programme);
      expect(toMSPDI(imported.programme)).toBe(xml);
    },
  );

  test("keeps everything the native fields cannot carry", () => {
    const programme = small({
      id: "job-7",
      revision: { code: "C", note: "Weather" },
      contractCompletion: "2026-12-18",
      markers: [{ id: "m1", date: "2026-11-04", label: "Site visit" }],
      delayEvents: [
        { id: "d1", kind: "weather", from: "2026-11-03", to: "2026-11-03", taskIds: ["A"] },
      ],
      fields: { client: "Acme" },
      tasks: [
        {
          id: "A",
          name: "Strip out",
          start: "2026-11-02",
          duration: 3,
          locked: true,
          style: { color: "#c00" },
          fields: { cost: 120000, charge: 150000 },
          owner: "JS",
          collapsed: false,
        },
        {
          id: "P",
          name: "Stage payment",
          type: "payment",
          start: "2026-11-04",
          duration: 0,
          valuePercent: 0.25,
        },
        { id: "N", name: "Drawings", type: "need-by", start: "2026-11-03", duration: 0, notes: "" },
      ],
      links: [{ id: "custom-id", from: "A", to: "P", type: "FS", lag: 0 }],
    });
    expect(fromMSPDI(toMSPDI(programme)).programme).toEqual(programme);
  });

  test("restores the original task and link order, and an absent links key", () => {
    const programme = small({
      tasks: [
        { id: "child", name: "Child", parent: "S", start: "2026-11-02", duration: 1 },
        { id: "S", name: "Summary", type: "summary" },
      ],
      links: undefined,
    });
    delete programme.links;
    expect(fromMSPDI(toMSPDI(programme)).programme).toEqual(programme);
    const linked = small({ links: [small().links[1], small().links[0]] });
    expect(fromMSPDI(toMSPDI(linked)).programme.links.map((link) => link.id)).toEqual(["l2", "l1"]);
  });

  test("a task residue over 255 characters moves to the project notes", () => {
    const programme = small();
    programme.tasks[0].fields = { longNote: "x".repeat(400) };
    const xml = toMSPDI(programme);
    const task = exportedTasks(xml).A;
    const text4 = children(task, "ExtendedAttribute").find(
      (attribute) => textOf(attribute, "FieldID") === "188743740",
    );
    expect(text4).toBeUndefined();
    expect(xml).toContain("&quot;x&quot;:{&quot;A&quot;");
    expect(fromMSPDI(xml).programme).toEqual(programme);
  });

  test("special characters, control characters and long text survive", () => {
    const name = `Kitchen & bath <phase 2> "B" 'C' é中\u{1F3D7} \u0001tab\tend`;
    const programme = small();
    programme.tasks[0].name = name;
    programme.tasks[0].notes = `Line 1\nLine 2 & <3>\n${"long ".repeat(500)}`;
    programme.tasks[0].trade = "M&E";
    const xml = toMSPDI(programme);
    expect(() => parseXml(xml)).not.toThrow();
    expect(fromMSPDI(xml).programme).toEqual(programme);
  });

  test("an empty programme round-trips", () => {
    const programme = { tasks: [] };
    expect(fromMSPDI(toMSPDI(programme)).programme).toEqual(programme);
  });
});

describe("text XML 1.0 cannot carry (issue #9, ADR-0012)", () => {
  test("the issue #9 repro: a task named U+FFFE round-trips", () => {
    const programme = {
      schema: "streamlined-gantt/1",
      name: "R",
      tasks: [{ id: "t6", name: "\ufffe", start: "2043-12-15", duration: 2 }],
      links: [],
    };
    expect(fromMSPDI(toMSPDI(programme)).programme.tasks[0].name).toBe("\ufffe");
  });

  /**
   * A programme with `text` in every text field the writer emits: project
   * name and currency, calendar and exception names, task id, name, WBS,
   * notes, trade, crew and custom fields, and link ids. The second task's
   * residue overflows Text4, and its id collides with the first task's id
   * once the illegal text is dropped.
   */
  const hostile = (text) => ({
    schema: "streamlined-gantt/1",
    name: `Programme ${text}`,
    currency: `GBP${text}`,
    calendars: [
      {
        ...ewCalendar(),
        name: `Site ${text}`,
        nonWorking: [{ date: "2043-12-25", name: `Christmas ${text}` }],
      },
    ],
    tasks: [
      {
        id: `A${text}`,
        name: `Strip ${text} out`,
        wbs: `1.${text}`,
        notes: `Note ${text}`,
        trade: `M&E ${text}`,
        crew: text,
        fields: { [text]: text },
        start: "2043-12-15",
        duration: 2,
      },
      { id: "A", name: `${text}${"long ".repeat(60)}`, start: "2043-12-17", duration: 1 },
    ],
    links: [{ id: `l${text}`, from: `A${text}`, to: "A" }],
  });

  test.each(XML_ILLEGAL_CLASSES)(
    "%s in every text field: well-formed XML, lossless round trip, stable re-export",
    async (_label, text) => {
      const programme = hostile(text);
      expect(collectProblems(programme)).toEqual([]);
      const xml = toMSPDI(programme);
      expect(illegalXmlCharacters(xml)).toEqual([]);
      await assertWellFormedXml1(xml);
      const imported = fromMSPDI(xml);
      expect(imported.programme).toEqual(programme);
      expect(imported.warnings).toEqual([]);
      expect(toMSPDI(imported.programme)).toBe(xml);
    },
  );

  test("other tools see the text with the illegal characters dropped", () => {
    const { programme } = readProgramme(toMSPDI(hostile("\ufffe\u0001\ud800")), false);
    expect(programme.name).toBe("Programme");
    expect(programme.tasks[0]).toMatchObject({ id: "A", name: "Strip  out", notes: "Note " });
    expect(programme.tasks[1].id).toBe("t2");
  });

  test("a carriage return is written as a character reference so XML parsers keep it", () => {
    const programme = small();
    programme.tasks[0].notes = "Line 1\r\nLine 2\rLine 3";
    const xml = toMSPDI(programme);
    expect(xml).toContain("<Notes>Line 1&#13;\nLine 2&#13;Line 3</Notes>");
    expect(fromMSPDI(xml).programme).toEqual(programme);
  });
});

describe("export writes native MSPDI fields", () => {
  const xml = lazy(() => ({ text: toMSPDI(loadFixture("programmes/spec-example.v1.json")) }));

  test("project header, calendar and extended attribute definitions", () => {
    const root = parseXml(xml.text);
    expect(root.attributes.xmlns).toBe("http://schemas.microsoft.com/project");
    expect(textOf(root, "MinutesPerDay")).toBe("480");
    expect(textOf(root, "DefaultStartTime")).toBe("08:00:00");
    const definitions = children(child(root, "ExtendedAttributes"), "ExtendedAttribute");
    expect(definitions.map((definition) => textOf(definition, "Alias"))).toEqual([
      "streamlined-gantt id",
      "Trade",
      "Crew",
      "streamlined-gantt data",
    ]);
    const calendar = children(child(root, "Calendars"), "Calendar")[0];
    const weekDays = children(child(calendar, "WeekDays"), "WeekDay");
    expect(weekDays.map((day) => textOf(day, "DayWorking")).join("")).toBe("0111110");
    const first = children(child(calendar, "Exceptions"), "Exception")[0];
    expect(textOf(first, "Type")).toBe("1");
    expect(textOf(child(first, "TimePeriod"), "ToDate")).toMatch(/T23:59:00$/);
  });

  test("element order follows the MSPDI schema for Project and Task", () => {
    const root = parseXml(xml.text);
    const projectOrder = root.children.map((element) => element.name);
    expect(projectOrder.indexOf("CalendarUID")).toBeLessThan(projectOrder.indexOf("MinutesPerDay"));
    expect(projectOrder.slice(-3)).toEqual(["ExtendedAttributes", "Calendars", "Tasks"]);
    const expectedTaskOrder = [
      "UID",
      "ID",
      "Name",
      "Type",
      "IsNull",
      "WBS",
      "OutlineNumber",
      "OutlineLevel",
      "Start",
      "Finish",
      "Duration",
      "DurationFormat",
      "Milestone",
      "Summary",
      "FixedCost",
      "PercentComplete",
      "ActualStart",
      "ActualFinish",
      "ConstraintType",
      "CalendarUID",
      "ConstraintDate",
      "Notes",
      "PredecessorLink",
      "ExtendedAttribute",
      "Baseline",
    ];
    for (const task of children(child(root, "Tasks"), "Task")) {
      const names = task.children.map((element) => element.name);
      const ranks = names.map((name) => expectedTaskOrder.indexOf(name));
      expect(ranks.every((rank) => rank >= 0)).toBe(true);
      expect(ranks).toEqual([...ranks].sort((first, second) => first - second));
    }
  });

  test("tasks carry dates, working durations, outline and ids", () => {
    const programme = small({
      tasks: [
        { id: "S", name: "Phase", type: "summary" },
        {
          id: "A",
          name: "A",
          parent: "S",
          start: "2026-11-02",
          duration: 3,
          trade: "Joiner",
          crew: "Crew 2",
        },
        {
          id: "M",
          name: "Done",
          type: "milestone",
          parent: "S",
          start: "2026-11-04",
          duration: 0,
          value: 540000,
        },
      ],
      links: [],
    });
    const tasks = exportedTasks(toMSPDI(programme));
    expect(textOf(tasks.S, "Summary")).toBe("1");
    expect(textOf(tasks.S, "Start")).toBe("2026-11-02T08:00:00");
    expect(textOf(tasks.S, "Finish")).toBe("2026-11-04T17:00:00");
    expect(textOf(tasks.A, "OutlineLevel")).toBe("2");
    expect(textOf(tasks.A, "OutlineNumber")).toBe("1.1");
    expect(textOf(tasks.A, "Duration")).toBe("PT24H0M0S");
    expect(textOf(tasks.A, "Finish")).toBe("2026-11-04T17:00:00");
    expect(textOf(tasks.M, "Milestone")).toBe("1");
    expect(textOf(tasks.M, "Duration")).toBe("PT0H0M0S");
    expect(textOf(tasks.M, "FixedCost")).toBe("540000");
    const values = children(tasks.A, "ExtendedAttribute").map((attribute) =>
      textOf(attribute, "Value"),
    );
    expect(values).toEqual(["A", "Joiner", "Crew 2"]);
  });

  test.each([
    ["FS", 0, "1", "0"],
    ["SS", 2, "3", "9600"],
    ["FF", -1, "0", "-4800"],
    ["SF", 1, "2", "4800"],
  ])(
    "a %s link with lag %i is Type %s and LinkLag %s (tenths of a minute)",
    (type, lag, code, linkLag) => {
      const programme = small({ links: [{ id: "x", from: "A", to: "B", type, lag }] });
      const link = child(exportedTasks(toMSPDI(programme)).B, "PredecessorLink");
      expect(textOf(link, "PredecessorUID")).toBe("1");
      expect(textOf(link, "Type")).toBe(code);
      expect(textOf(link, "LinkLag")).toBe(linkLag);
      expect(textOf(link, "LagFormat")).toBe("7");
    },
  );

  test("minutesPerDay and working hours are configurable", () => {
    const options = { minutesPerDay: 450, startTime: "08:00:00", finishTime: "16:30:00" };
    const programme = small({ links: [{ id: "x", from: "A", to: "B", lag: 2 }] });
    const xml = toMSPDI(programme, options);
    const tasks = exportedTasks(xml);
    expect(textOf(parseXml(xml), "MinutesPerDay")).toBe("450");
    expect(textOf(tasks.A, "Duration")).toBe("PT22H30M0S");
    expect(textOf(tasks.A, "Finish")).toBe("2026-11-04T16:30:00");
    expect(textOf(child(tasks.B, "PredecessorLink"), "LinkLag")).toBe("9000");
    expect(fromMSPDI(xml).programme).toEqual(programme);
  });

  test("constraints, progress, status date and baselines", () => {
    const programme = small({
      dataDate: "2026-11-04",
      baselines: [
        { id: "b0", name: "Tender", tasks: { A: { start: "2026-11-02", finish: "2026-11-03" } } },
      ],
      tasks: [
        {
          id: "A",
          name: "A",
          start: "2026-11-02",
          duration: 3,
          progress: 0.5,
          actualStart: "2026-11-02",
          constraint: { type: "SNET", date: "2026-11-02" },
        },
        {
          id: "B",
          name: "B",
          start: "2026-11-05",
          duration: 2,
          constraint: { type: "FNLT", date: "2026-11-10" },
        },
      ],
      links: [],
    });
    const xml = toMSPDI(programme);
    const tasks = exportedTasks(xml);
    expect(textOf(parseXml(xml), "StatusDate")).toBe("2026-11-04T08:00:00");
    expect(textOf(tasks.A, "PercentComplete")).toBe("50");
    expect(textOf(tasks.A, "ActualStart")).toBe("2026-11-02T08:00:00");
    expect(textOf(tasks.A, "ConstraintType")).toBe("4");
    expect(textOf(tasks.B, "ConstraintType")).toBe("7");
    expect(textOf(tasks.B, "ConstraintDate")).toBe("2026-11-10T17:00:00");
    const baseline = child(tasks.A, "Baseline");
    expect([textOf(baseline, "Number"), textOf(baseline, "Finish")]).toEqual([
      "0",
      "2026-11-03T17:00:00",
    ]);
    expect(fromMSPDI(xml).programme).toEqual(programme);
  });

  test("refuses data without a tasks array", () => {
    expect(() => toMSPDI(/** @type {any} */ ({}))).toThrow(TypeError);
    expect(() => toMSPDI(/** @type {any} */ (null))).toThrow(/tasks array/);
  });
});

describe("import of files from other tools", () => {
  test("produces valid programme data", () => {
    expect(collectProblems(foreign.programme)).toEqual([]);
  });

  test("reads the project header and the base calendar's work week", () => {
    const { programme } = foreign;
    expect(programme).toMatchObject({
      name: "Riverside block & car park",
      currency: "GBP",
      dataDate: "2026-11-09",
      defaultCalendar: "cal-3",
    });
    expect(programme.calendars).toHaveLength(1);
    expect(programme.calendars[0]).toMatchObject({
      id: "cal-3",
      name: "Site week",
      workWeek: [1, 2, 3, 4, 5],
    });
  });

  test("expands recurring exceptions and ignores the legacy duplicate list", () => {
    const byName = {};
    for (const entry of foreign.programme.calendars[0].nonWorking) {
      (byName[entry.name] ??= []).push(entry.date ?? `${entry.from}..${entry.to}`);
    }
    expect(byName).toEqual({
      Christmas: ["2026-12-25..2026-12-26"],
      "Friday toolbox talk": ["2026-11-06", "2026-11-20", "2026-12-04"],
      "Last Friday": ["2027-01-29", "2027-02-26", "2027-03-26"],
      "Founders day": ["2027-05-12", "2028-05-12"],
      "First Monday": ["2027-02-01"],
      "Every tenth day": ["2027-03-01", "2027-03-11", "2027-03-21"],
      "Pay day": ["2027-01-31", "2027-07-31"],
    });
    expect(foreign.programme.calendars[0].working).toEqual([
      { date: "2026-11-14", name: "Saturday worked" },
    ]);
  });

  test("normalises finishes and converts durations at the file's minutes per day", () => {
    const tasks = Object.fromEntries(foreign.programme.tasks.map((task) => [task.id, task]));
    expect(tasks.t1).toEqual({ id: "t1", name: "Groundworks", wbs: "1", type: "summary" });
    expect(tasks.t2).toMatchObject({
      name: "Excavate <north> bay",
      parent: "t1",
      start: "2026-11-02",
      duration: 3,
      progress: 1,
      actualFinish: "2026-11-04",
      value: 125050,
      trade: "Groundworker",
    });
    expect(tasks.t3).toMatchObject({ duration: 5, finish: "2026-11-09", progress: 0.4 });
    expect(tasks.t3.constraint).toBeUndefined();
    expect(tasks.t4).toMatchObject({
      duration: 4,
      constraint: { type: "SNET", date: "2026-11-10" },
    });
    expect(tasks.t6).toMatchObject({
      type: "milestone",
      start: "2026-11-13",
      duration: 0,
      calendar: "cal-3",
      constraint: { type: "FNLT", date: "2026-11-20" },
    });
    expect(tasks.t7).toMatchObject({ start: "2026-11-16", duration: 1 });
    expect(tasks.t5).toBeUndefined();
  });

  test("an unrelated Text1 is not taken for an id; fields are found by alias", () => {
    const ids = foreign.programme.tasks.map((task) => task.id);
    expect(ids).toEqual(["t1", "t2", "t3", "t4", "t6", "t7"]);
    expect(foreign.programme.tasks.find((task) => task.id === "t7").trade).toBeUndefined();
  });

  test("reads links with types and lags, and reports what it drops", () => {
    expect(foreign.programme.links).toEqual([
      { id: "t2-t3", from: "t2", to: "t3" },
      { id: "t3-t4", from: "t3", to: "t4", lag: 1 },
      { id: "t2-t4", from: "t2", to: "t4", type: "SS" },
      { id: "t4-t6", from: "t4", to: "t6", type: "FF", lag: -1 },
      { id: "t3-t6", from: "t3", to: "t6", type: "SF", lag: 2 },
    ]);
    expect(foreign.warnings).toEqual([
      '"Pour slab": MSO constraint dropped (unsupported)',
      '"Pour slab": link from a missing task dropped',
      '"Cure": elapsed lag converted to working days',
      '"Cure": percentage lag dropped',
    ]);
  });

  test("reads baselines by number with normalised finishes", () => {
    expect(foreign.programme.baselines).toEqual([
      { id: "baseline-0", tasks: { t6: { start: "2026-11-12", finish: "2026-11-12" } } },
      { id: "baseline-1", tasks: { t7: { start: "2026-11-16", finish: "2026-11-16" } } },
    ]);
  });

  test("a minimal file with no calendars, header or durations still imports", () => {
    const xml = `<Project xmlns="http://schemas.microsoft.com/project"><Tasks>
      <Task><UID>1</UID><Name>Only</Name><Start>2026-11-02T08:00:00</Start><Finish>2026-11-03T17:00:00</Finish></Task>
      <Task><UID>2</UID><Name>No dates</Name><Duration>junk</Duration></Task>
      <Task><UID>3</UID><Name>Fin only</Name><Start>2026-11-02T08:00:00</Start></Task>
      <Task><UID>4</UID><Name>Odd</Name><Start>2026-11-02T08:00:00</Start><ConstraintType>99</ConstraintType>
        <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>9</Type></PredecessorLink>
        <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task>
    </Tasks></Project>`;
    const { programme, warnings } = fromMSPDI(xml);
    expect(programme.calendars).toEqual([]);
    expect(programme.defaultCalendar).toBeUndefined();
    expect(programme.tasks[0]).toEqual({
      id: "t1",
      name: "Only",
      start: "2026-11-02",
      duration: 2,
    });
    expect(programme.tasks[1]).toEqual({ id: "t2", name: "No dates" });
    expect(programme.tasks[2]).toMatchObject({ duration: 1 });
    expect(programme.links.map((link) => link.id)).toEqual(["t1-t4", "t1-t4-2"]);
    expect(warnings).toEqual(['"Odd": type 99 constraint dropped (unsupported)']);
  });

  test("finishes are normalised on the task's own calendar", () => {
    const weekDays = (working) =>
      [1, 2, 3, 4, 5, 6, 7]
        .map(
          (day) =>
            `<WeekDay><DayType>${day}</DayType><DayWorking>${working.includes(day) ? 1 : 0}</DayWorking></WeekDay>`,
        )
        .join("");
    const xml = `<Project><CalendarUID>1</CalendarUID><Calendars>
      <Calendar><UID>1</UID><Name>Office</Name><WeekDays>${weekDays([2, 3, 4, 5, 6])}</WeekDays></Calendar>
      <Calendar><UID>2</UID><Name>Six-day site</Name><WeekDays>${weekDays([2, 3, 4, 5, 6, 7])}</WeekDays></Calendar>
    </Calendars><Tasks>
      <Task><UID>1</UID><Name>Office task</Name><Start>2026-11-09T08:00:00</Start><Finish>2026-11-16T08:00:00</Finish><DurationFormat>8</DurationFormat><PercentComplete>100</PercentComplete><ActualFinish>2026-11-16T08:00:00</ActualFinish></Task>
      <Task><UID>2</UID><Name>Site task</Name><CalendarUID>2</CalendarUID><Start>2026-11-09T08:00:00</Start><Finish>2026-11-16T08:00:00</Finish><DurationFormat>8</DurationFormat><PercentComplete>100</PercentComplete><ActualFinish>2026-11-16T08:00:00</ActualFinish></Task>
    </Tasks></Project>`;
    const [office, site] = fromMSPDI(xml).programme.tasks;
    expect(office).toMatchObject({ actualFinish: "2026-11-13", duration: 5 });
    expect(site).toMatchObject({ calendar: "cal-2", actualFinish: "2026-11-14", duration: 6 });
  });

  test("duplicate stored ids fall back to UID-based ids", () => {
    const definition = `<ExtendedAttributes><ExtendedAttribute><FieldID>188743731</FieldID><Alias>streamlined-gantt id</Alias></ExtendedAttribute></ExtendedAttributes>`;
    const task = (uid) =>
      `<Task><UID>${uid}</UID><Name>T${uid}</Name><Start>2026-11-02T08:00:00</Start><Duration>PT8H0M0S</Duration><ExtendedAttribute><FieldID>188743731</FieldID><Value>same</Value></ExtendedAttribute></Task>`;
    const xml = `<Project>${definition}<Tasks>${task(1)}${task(2)}</Tasks></Project>`;
    expect(fromMSPDI(xml).programme.tasks.map((entry) => entry.id)).toEqual(["same", "t2"]);
  });

  test("a native edit made in another tool is kept", () => {
    const xml = toMSPDI(small()).replace(
      "<Name>Strip out</Name>",
      "<Name>Strip out (revised)</Name>",
    );
    expect(fromMSPDI(xml).programme.tasks[0].name).toBe("Strip out (revised)");
  });

  test("an unreadable residue is reported and the native fields are used", () => {
    const programme = small();
    programme.tasks[0].locked = true;
    const xml = toMSPDI(programme).replace(
      /(<FieldID>188743740<\/FieldID>\s*<Value>)[^<]+/,
      "$1{not json",
    );
    const { programme: imported, warnings } = fromMSPDI(xml);
    expect(imported.tasks[0].locked).toBeUndefined();
    expect(warnings).toEqual(["Unreadable streamlined-gantt data ignored"]);
  });
});

describe("calendar import edge cases", () => {
  /** Imports one calendar built from `body`, returning it and the warnings. */
  function importCalendar(body, header = "<Name>Cal</Name>") {
    const xml = `<Project><CalendarUID>1</CalendarUID><Calendars><Calendar><UID>1</UID>${header}${body}</Calendar></Calendars></Project>`;
    const { programme, warnings } = fromMSPDI(xml);
    return { calendar: programme.calendars[0], warnings };
  }

  const exception = (fields) =>
    `<Exceptions><Exception>${fields}<DayWorking>0</DayWorking></Exception></Exceptions>`;
  const period = (from, to) =>
    `<TimePeriod><FromDate>${from}T00:00:00</FromDate><ToDate>${to}T23:59:00</ToDate></TimePeriod>`;
  const days = (calendar) =>
    (calendar.nonWorking ?? []).map((entry) => entry.date ?? `${entry.from}..${entry.to}`);

  test("Project 2003 exceptions are read when there is no Exceptions list", () => {
    const legacy = (from, to, working) =>
      `<WeekDay><DayType>0</DayType><DayWorking>${working}</DayWorking><TimePeriod><FromDate>${from}</FromDate><ToDate>${to}</ToDate></TimePeriod></WeekDay>`;
    const { calendar } = importCalendar(
      `<WeekDays>${legacy("2026-12-25T00:00:00", "2026-12-26T23:59:00", 0)}${legacy("2026-11-14T00:00:00", "2026-11-15T00:00:00", 1)}<WeekDay><DayType>0</DayType></WeekDay></WeekDays>`,
      "",
    );
    expect(calendar).toEqual({
      id: "cal-1",
      name: "Calendar 1",
      nonWorking: [{ from: "2026-12-25", to: "2026-12-26" }],
      working: [{ date: "2026-11-14" }],
    });
  });

  test("resource calendars are skipped and a missing TimePeriod is ignored", () => {
    const { calendar } = importCalendar(exception("<Name>No period</Name><Type>1</Type>"));
    expect(calendar.nonWorking).toBeUndefined();
  });

  test("a range that ends before it starts is ignored", () => {
    expect(days(importCalendar(exception(period("2027-01-10", "2027-01-01"))).calendar)).toEqual(
      [],
    );
  });

  test("daily with a period, occurrences 0 meaning no limit", () => {
    const { calendar } = importCalendar(
      exception(
        `${period("2027-01-01", "2027-01-07")}<Type>1</Type><Period>3</Period><Occurrences>0</Occurrences>`,
      ),
    );
    expect(days(calendar)).toEqual(["2027-01-01", "2027-01-04", "2027-01-07"]);
  });

  test("weekly on several days (Monday and Wednesday every week)", () => {
    const { calendar } = importCalendar(
      exception(`${period("2027-01-01", "2027-01-14")}<Type>6</Type><DaysOfWeek>10</DaysOfWeek>`),
    );
    expect(days(calendar)).toEqual(["2027-01-04", "2027-01-06", "2027-01-11", "2027-01-13"]);
  });

  test("monthly relative fourth Thursday, monthly absolute with the default day", () => {
    const fourthThursday = importCalendar(
      exception(
        `${period("2027-01-01", "2027-02-28")}<Type>5</Type><MonthItem>7</MonthItem><MonthPosition>3</MonthPosition>`,
      ),
    );
    expect(days(fourthThursday.calendar)).toEqual(["2027-01-28", "2027-02-25"]);
    const firstOfMonth = importCalendar(
      exception(`${period("2027-01-01", "2027-03-31")}<Type>4</Type><Period>2</Period>`),
    );
    expect(days(firstOfMonth.calendar)).toEqual(["2027-01-01", "2027-03-01"]);
  });

  test("yearly relative: the last Monday of May (spring bank holiday)", () => {
    const { calendar } = importCalendar(
      exception(
        `${period("2026-01-01", "2028-12-31")}<Type>3</Type><Month>4</Month><MonthItem>4</MonthItem><MonthPosition>4</MonthPosition>`,
      ),
    );
    expect(days(calendar)).toEqual(["2026-05-25", "2027-05-31", "2028-05-29"]);
  });

  test("an unknown recurrence is read as one range with a warning", () => {
    const { calendar, warnings } = importCalendar(
      exception(`${period("2027-01-01", "2027-01-03")}<Name>Odd</Name><Type>42</Type>`),
    );
    expect(days(calendar)).toEqual(["2027-01-01..2027-01-03"]);
    expect(warnings).toEqual([
      'Calendar exception "Odd" has an unknown recurrence; read as a range',
    ]);
  });
});

describe("unsafe or malformed input", () => {
  test("rejects external entities before reading anything", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x SYSTEM "file:///etc/passwd">]><Project><Title>&x;</Title></Project>`;
    expect(() => fromMSPDI(xxe)).toThrow(MspdiParseError);
  });

  test("rejects malformed XML with a position", () => {
    expect(() => fromMSPDI("<Project><Tasks></Project>")).toThrow(/line 1, column/);
  });

  test("rejects a document that is not a project", () => {
    expect(() => fromMSPDI("<Schedule/>")).toThrow(/root element is <Schedule>/);
  });

  test("results are not validated here; validateProgramme or loading reports problems", () => {
    const xml = `<Project><Tasks><Task><UID>1</UID><Name>A</Name></Task><Task><UID>2</UID><Name>B</Name><OutlineLevel>2</OutlineLevel><Start>2026-11-02T08:00:00</Start><Duration>PT8H0M0S</Duration><Summary>0</Summary></Task></Tasks></Project>`;
    const { programme } = fromMSPDI(xml);
    expect(programme.tasks).toHaveLength(2);
    expect(collectProblems(programme).map((problem) => problem.path)).toEqual([
      "/tasks/0/start",
      "/tasks/0",
    ]);
  });
});
