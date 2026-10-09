// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "vitest";
import {
  Calendar,
  FieldRegistry,
  analyse,
  checkProgramme,
  formatDate,
  programmeToCSV,
  projectSummary,
  schedule,
  toDay,
} from "../../src/engine/index.js";
import { ewCalendar, loadFixture } from "../support/builders.js";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";

const RealDate = globalThis.Date;
const LOCAL_METHODS = [
  "getDate",
  "getDay",
  "getMonth",
  "getFullYear",
  "getHours",
  "setDate",
  "setHours",
  "getTimezoneOffset",
];

test("the engine never constructs a Date or calls local-time methods during arithmetic", () => {
  const calls = [];
  const originals = Object.fromEntries(
    LOCAL_METHODS.map((method) => [method, RealDate.prototype[method]]),
  );
  for (const method of LOCAL_METHODS) {
    RealDate.prototype[method] = function spied(...args) {
      calls.push(method);
      return originals[method].apply(this, args);
    };
  }
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      calls.push("new Date");
      return Reflect.construct(target, args);
    },
  });
  try {
    const calendar = new Calendar(ewCalendar());
    calendar.addWorkingDays("2026-12-23", 2);
    calendar.workingDaysBetween("2026-03-23", "2026-04-10");
    const programme = loadFixture("programmes/flat-roof.json");
    const fields = new FieldRegistry(FLAT_ROOF_FIELDS);
    const analysis = analyse(programme, { fields });
    projectSummary(analysis, programme, { bucket: "week" });
    checkProgramme(analysis, programme);
    programmeToCSV(analysis, programme);
    schedule({ tasks: programme.tasks, links: programme.links, calendar, mode: "propagate" });
    formatDate(toDay("2026-10-25"));
  } finally {
    for (const method of LOCAL_METHODS) RealDate.prototype[method] = originals[method];
    globalThis.Date = RealDate;
  }
  expect(calls).toEqual([]);
});
