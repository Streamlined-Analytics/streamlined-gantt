// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import { analyse, checkProgramme, MAX_ACTIVITY_DAYS } from "../../src/engine/index.js";
import { ewCalendar, loadFixture, scheduledProgramme } from "../support/builders.js";

const check = (programme, options) => checkProgramme(analyse(programme), programme, options);
const codes = (findings) =>
  findings.map((finding) => `${finding.code}:${finding.taskId ?? finding.linkId}`);

describe("programme health check", () => {
  test("the flat-roof job only flags the open-ended first stage payment", () => {
    expect(codes(check(loadFixture("programmes/flat-roof.json")))).toEqual(["open-end:p1"]);
  });

  test("N1 with a deadline flags every negative-float task", () => {
    const findings = check(scheduledProgramme(loadFixture("programmes/cpm-n1-deadline.json")));
    expect(findings.filter((finding) => finding.code === "negative-float")).toHaveLength(9);
    expect(findings.find((finding) => finding.taskId === "A")).toMatchObject({
      severity: "error",
      message: "Negative float of -2 working days",
    });
  });

  test("open starts and ends, long durations and lags, hard constraints, summary links", () => {
    const programme = {
      calendars: [ewCalendar()],
      tasks: [
        { id: "s", name: "Phase", type: "summary" },
        {
          id: "a",
          name: "A",
          parent: "s",
          start: "2026-11-02",
          duration: 30,
          constraint: { type: "FNLT", date: "2027-01-29" },
        },
        { id: "b", name: "B", start: "2026-11-04", duration: 2 },
        { id: "c", name: "C", start: "2026-11-05", duration: 1 },
        {
          id: "m",
          name: "Milestone with a duration",
          type: "milestone",
          start: "2026-11-05",
          duration: 2,
        },
        { id: "r", name: "MC access", type: "access", locked: true, start: "2026-11-10" },
      ],
      links: [
        { id: "l1", from: "s", to: "c", lag: 40 },
        { id: "l2", from: "b", to: "m" },
      ],
    };
    const findings = codes(check(programme));
    expect(findings).toEqual(
      expect.arrayContaining([
        "long-duration:a",
        "hard-constraint:a",
        "open-start:b",
        "milestone-duration:m",
        "negative-float:a",
        "open-end:m",
        "long-lag:l1",
        "summary-link:l1",
      ]),
    );
    expect(findings).not.toContain("open-start:r");
    expect(findings).not.toContain("open-start:c");
    expect(findings).not.toContain("open-end:a");
  });

  test("the duration limit is configurable", () => {
    const programme = { tasks: [{ id: "a", name: "A", start: "2026-11-02", duration: 10 }] };
    expect(codes(check(programme, { maxDuration: 5 }))).toEqual(["long-duration:a"]);
    expect(MAX_ACTIVITY_DAYS).toBe(28);
  });

  test("out-of-sequence progress and schedule violations are included", () => {
    const programme = {
      tasks: [
        { id: "a", name: "A", start: "2026-11-02", duration: 3, progress: 0.5 },
        { id: "b", name: "B", start: "2026-11-03", duration: 2, progress: 0.2 },
        { id: "c", name: "C", start: "2026-11-03", duration: 1 },
        { id: "d", name: "D", start: "2026-11-09", duration: 1 },
      ],
      links: [
        { id: "l1", from: "a", to: "b" },
        { id: "l2", from: "a", to: "c" },
        { id: "l3", from: "b", to: "d", type: "SS" },
        { id: "l4", from: "c", to: "d" },
      ],
    };
    const findings = check(programme);
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "out-of-sequence", taskId: "b", linkId: "l1" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "link-violated",
        taskId: "c",
        linkId: "l2",
        severity: "warning",
      }),
    );
    expect(findings.filter((finding) => finding.code === "out-of-sequence")).toHaveLength(1);
  });
});
