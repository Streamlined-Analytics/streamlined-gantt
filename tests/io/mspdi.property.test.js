// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { collectProblems } from "../../src/engine/schema.js";
import { fromMSPDI, toMSPDI } from "../../src/io/mspdi.js";
import { parseXml } from "../../src/io/xml.js";
import { RUNS, arbCalendarAround, arbDag } from "../support/arbitraries.js";
import { illegalXmlCharacters } from "../support/xml1.js";

/**
 * Random valid programmes: a DAG of tasks with random types, hierarchy,
 * progress, constraints, text (any Unicode, including characters XML cannot
 * carry), custom fields and a random calendar. Anything that fails
 * validation is discarded, since export rejects invalid data by design.
 * Programmes are JSON, so generated data is passed through JSON once (which,
 * for example, turns -0 into 0).
 */
const POINT_TYPES = ["milestone", "payment", "access", "need-by"];
const BAR_TYPES = [undefined, "task", "reference"];

const arbTaskExtras = fc.record(
  {
    kind: fc.constantFrom(...BAR_TYPES, ...POINT_TYPES),
    parentPick: fc.nat(),
    hasParent: fc.boolean(),
    name: fc.string({ unit: "binary", maxLength: 30 }),
    trade: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
    notes: fc.option(fc.string({ unit: "binary", maxLength: 60 }), { nil: undefined }),
    progress: fc.option(fc.constantFrom(0, 0.25, 1 / 3, 0.5, 1), { nil: undefined }),
    value: fc.option(fc.integer({ min: -1e9, max: 1e9 }), { nil: undefined }),
    snet: fc.option(fc.integer({ min: -20, max: 20 }), { nil: undefined }),
    fields: fc.option(
      fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 3 }),
      {
        nil: undefined,
      },
    ),
    locked: fc.option(fc.boolean(), { nil: undefined }),
  },
  { requiredKeys: ["kind", "parentPick", "hasParent", "name"] },
);

const arbProgramme = fc
  .tuple(arbDag({ maxTasks: 15 }), arbCalendarAround())
  .chain(([dag, around]) => {
    const ids = Object.keys(dag.durations);
    return fc
      .tuple(
        fc.array(arbTaskExtras, { minLength: ids.length, maxLength: ids.length }),
        fc.boolean(),
      )
      .map(([extras, withLinksKey]) => buildProgramme(dag, around, ids, extras, withLinksKey));
  });

function buildProgramme(dag, around, ids, extras, withLinksKey) {
  const start = around.centre;
  const summaries = new Set();
  const tasks = ids.map((id, index) => {
    const extra = extras[index];
    const point = POINT_TYPES.includes(extra.kind) || dag.durations[id] === 0;
    const task = { id, name: extra.name, start, duration: point ? 0 : dag.durations[id] };
    if (extra.kind)
      task.type = point && !POINT_TYPES.includes(extra.kind) ? "milestone" : extra.kind;
    if (extra.hasParent && index > 0) {
      const parent = `S${extra.parentPick % 3}`;
      summaries.add(parent);
      task.parent = parent;
    }
    for (const key of ["trade", "notes", "progress", "value", "fields", "locked"]) {
      if (extra[key] !== undefined) task[key] = extra[key];
    }
    if (extra.snet !== undefined)
      task.constraint = { type: "SNET", date: offsetDate(start, extra.snet) };
    return task;
  });
  const summaryTasks = [...summaries].map((id) => ({ id, name: `Summary ${id}`, type: "summary" }));
  const programme = {
    schema: "streamlined-gantt/1",
    name: "Random",
    calendars: [around.calendar],
    tasks: [...tasks, ...summaryTasks],
  };
  if (withLinksKey || dag.links.length) programme.links = dag.links;
  return JSON.parse(JSON.stringify(programme));
}

function offsetDate(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Text drawn mostly from characters XML 1.0 cannot carry (issue #9): C0
 * controls, lone surrogates, U+FFFE and U+FFFF, carriage returns, plus markup
 * characters, an astral character and plain letters. `fc.string` with the
 * `binary` unit almost never produces these, so they get their own alphabet.
 */
const arbHostileText = fc.string({
  unit: fc.constantFrom(
    "\u0000",
    "\u0001",
    "\u000b",
    "\u001f",
    "\ud800",
    "\udfff",
    "\ufffe",
    "\uffff",
    "\r",
    "\t",
    "&",
    "<",
    "\u{1F3D7}",
    "a",
    " ",
  ),
  maxLength: 8,
});

/**
 * Puts hostile text into every text field the writer emits: the programme
 * name and currency, calendar names, and each task's id, name, WBS, notes,
 * trade, crew and a custom field. Ids keep a `|` separator so they stay
 * unique; links follow their tasks.
 */
const arbHostileProgramme = arbProgramme.chain((programme) =>
  fc
    .record({
      name: arbHostileText,
      currency: arbHostileText,
      calendar: arbHostileText,
      tasks: fc.array(fc.array(arbHostileText, { minLength: 6, maxLength: 6 }), {
        minLength: programme.tasks.length,
        maxLength: programme.tasks.length,
      }),
    })
    .map((texts) => withHostileText(programme, texts)),
);

function withHostileText(programme, texts) {
  const renamed = new Map(
    programme.tasks.map((task, index) => [task.id, `${task.id}|${texts.tasks[index][0]}`]),
  );
  const rename = (id) => renamed.get(id) ?? id;
  const tasks = programme.tasks.map((task, index) => {
    const [, name, wbs, notes, trade, crew] = texts.tasks[index];
    const hostile = { ...task, id: rename(task.id), name: `${task.name}${name}`, wbs, notes };
    if (task.parent) hostile.parent = rename(task.parent);
    if (trade) hostile.trade = trade;
    if (crew) hostile.crew = crew;
    hostile.fields = { ...task.fields, [crew]: trade };
    return hostile;
  });
  const result = {
    ...programme,
    name: texts.name,
    currency: texts.currency,
    calendars: programme.calendars.map((calendar) => ({ ...calendar, name: texts.calendar })),
    tasks,
  };
  if (programme.links)
    result.links = programme.links.map((link) => ({
      ...link,
      from: rename(link.from),
      to: rename(link.to),
    }));
  return result;
}

/**
 * The round-trip contract: the export is XML 1.0 (no character a strict
 * parser rejects), imports back deep-equal with no warnings, and re-exports
 * byte-identically.
 * @param {object} programme
 */
function expectLosslessRoundTrip(programme) {
  const xml = toMSPDI(programme);
  expect(illegalXmlCharacters(xml)).toEqual([]);
  expect(() => parseXml(xml)).not.toThrow();
  const imported = fromMSPDI(xml);
  expect(imported.programme).toEqual(programme);
  expect(imported.warnings).toEqual([]);
  expect(toMSPDI(imported.programme)).toBe(xml);
}

const NUM_RUNS = Math.max(100, Math.round(RUNS / 5));

describe("MSPDI round trip (property)", () => {
  test.prop([arbProgramme], { numRuns: NUM_RUNS })(
    "any valid programme imports back deep-equal, and re-exports byte-identically",
    (programme) => {
      fc.pre(collectProblems(programme).length === 0);
      expectLosslessRoundTrip(programme);
    },
  );

  test.prop([arbProgramme], { numRuns: NUM_RUNS, seed: -1576626285 })(
    "issue #9 regression: the seed that found a U+FFFE task name dropped (TZ=America/Los_Angeles)",
    (programme) => {
      fc.pre(collectProblems(programme).length === 0);
      expectLosslessRoundTrip(programme);
    },
  );

  test.prop([arbHostileProgramme], { numRuns: NUM_RUNS })(
    "text XML 1.0 cannot carry, in any text field, survives the round trip",
    (programme) => {
      fc.pre(collectProblems(programme).length === 0);
      expectLosslessRoundTrip(programme);
    },
  );
});
