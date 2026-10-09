// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import { TimeScale, zoomForDayWidth } from "../../../src/ui/scale.js";

const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;

describe("time scale", () => {
  test("by default the range is padded and rounded to whole weeks", () => {
    const scale = new TimeScale({
      zoom: "week",
      start: day("2027-03-03"),
      finish: day("2027-05-07"),
    });
    expect(scale.start).toBe(day("2027-02-01"));
    expect(scale.start).toBeLessThan(day("2027-03-03") - 28);
  });

  test("with lead and trail the range is exact, so it starts just before the first task", () => {
    const scale = new TimeScale({
      zoom: "week",
      start: day("2027-03-01"),
      finish: day("2027-05-07"),
      lead: 2,
      trail: 3,
      dayWidth: 10,
    });
    expect(scale.start).toBe(day("2027-02-27"));
    expect(scale.end).toBe(day("2027-05-11"));
    expect(scale.width).toBe((scale.end - scale.start) * 10);
    expect(scale.ticks("bottom")[0].x).toBe(0);
  });

  test.each([
    [40, "day"],
    [24, "day"],
    [12, "week"],
    [9, "week"],
    [4, "month"],
    [2.5, "month"],
    [1, "quarter"],
  ])("a %s px day uses %s header tiers", (dayWidth, zoom) => {
    expect(zoomForDayWidth(dayWidth)).toBe(zoom);
  });
});
