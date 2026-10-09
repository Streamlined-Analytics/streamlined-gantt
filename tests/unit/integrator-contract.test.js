// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  Calendar,
  FieldRegistry,
  analyse,
  projectSummary,
  schedule,
  validateProgramme,
} from "../../src/engine/index.js";
import { loadFixture } from "../support/builders.js";

/**
 * The sample programme served by the Streamlined Analytics website at
 * /construction-gantt-chart/programme.json (streamlined_analytics PR #446), produced by an
 * independent Python scheduler. It pins the integrator data contract: camelCase, ISO dates,
 * inclusive finishes, working-day durations, pence, 0-1 percentages, FS/SS links with lag.
 */
describe("integrator contract: SA website sample programme", () => {
  const programme = () => loadFixture("programmes/office-fit-out-sa446.json");

  test("validates against the v1 format", () => {
    expect(() => validateProgramme(programme())).not.toThrow();
  });

  test("our scheduler agrees with the independent Python scheduler on every date", () => {
    const data = programme();
    const result = schedule({
      tasks: data.tasks,
      links: data.links,
      calendar: new Calendar(data.calendars[0]),
      mode: "propagate",
    });
    expect(result.changed).toEqual([]);
    expect(result.projectFinish).toBe("2027-05-07");
  });

  test("summary totals and stage payments", () => {
    const data = programme();
    const fields = new FieldRegistry([
      { key: "cost", type: "currency", rollup: "sum" },
      { key: "charge", type: "currency", rollup: "sum" },
    ]);
    const summary = projectSummary(analyse(data, { fields }), data, { bucket: "week" });
    expect(summary.sums).toEqual({ cost: 15201248, charge: 18590000 });
    expect(summary.payments.map((payment) => [payment.date, payment.value])).toEqual([
      ["2027-03-09", 1859000],
      ["2027-03-23", 4647500],
      ["2027-04-14", 5577000],
      ["2027-05-07", 6506500],
    ]);
    expect(summary.series.paymentsCumulative.at(-1)).toBe(18590000);
  });
});
