// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "vitest";
import * as core from "../../src/index.js";
import * as engine from "../../src/engine/index.js";

/** Pins the public API so additions and removals are deliberate. */
test("the core entry exports the documented API", () => {
  expect(Object.keys(core).sort()).toMatchInlineSnapshot(`
    [
      "CONSTRAINT_TYPES",
      "Calendar",
      "CalendarHasNoWorkingTimeError",
      "DEFAULT_STRINGS",
      "DELAY_KINDS",
      "EVENT_NAME_LIST",
      "FieldRegistry",
      "Gantt",
      "GanttEvent",
      "GanttValidationError",
      "LINK_TYPES",
      "MAX_ACTIVITY_DAYS",
      "ProgrammeController",
      "SCHEMA_ID",
      "StreamlinedGanttElement",
      "TASK_TYPES",
      "VERSION",
      "addDays",
      "addMonths",
      "analyse",
      "asDay",
      "buildHierarchy",
      "checkProgramme",
      "collectProblems",
      "csvCell",
      "daysInMonth",
      "defineConfig",
      "defineElement",
      "expandLinks",
      "findCycle",
      "formatDate",
      "formatLongDate",
      "formatMoney",
      "formatPercent",
      "fromYMD",
      "isComplete",
      "isISODate",
      "isLeapYear",
      "isLocked",
      "isMilestone",
      "isStarted",
      "isoWeekday",
      "minorToDecimal",
      "minorUnitScale",
      "normaliseDatePatch",
      "parseMoney",
      "programmeToCSV",
      "projectSummary",
      "resolveLeafDates",
      "schedule",
      "schedulingCalendar",
      "startOfMonth",
      "startOfWeek",
      "toDay",
      "toISO",
      "toYMD",
      "today",
      "trustedHTML",
      "validateProgramme",
      "wouldCreateCycle",
    ]
  `);
});

test("everything the core re-exports from the engine is the same object as in the engine entry", () => {
  const shared = Object.keys(core).filter((name) => name in engine);
  for (const name of shared) expect(core[name], name).toBe(engine[name]);
  const engineOnly = Object.keys(engine)
    .filter((name) => !(name in core))
    .sort();
  expect(engineOnly).toEqual([
    "addWorkingDays",
    "fromGovUkBankHolidays",
    "isWorking",
    "nextWorkingDay",
    "paymentSchedule",
    "previousWorkingDay",
    "splitEvenly",
    "workingDaysBetween",
  ]);
});
