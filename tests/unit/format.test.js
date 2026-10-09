// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  formatDate,
  formatMoney,
  formatPercent,
  minorUnitScale,
  parseMoney,
  toDay,
} from "../../src/engine/index.js";

describe("formatting", () => {
  test("en-GB dates are dd/mm/yyyy regardless of the process time zone", () => {
    expect(formatDate(toDay("2026-11-02"))).toBe("02/11/2026");
    expect(
      formatDate(toDay("2026-03-29"), "en-GB", { weekday: "long", day: "numeric", month: "long" }),
    ).toBe("Sunday 29 March");
    expect(formatDate(toDay("2026-10-25"), "en-US")).toBe("10/25/2026");
  });

  test("money is formatted from integer minor units", () => {
    expect(formatMoney(900000)).toBe("£9,000.00");
    expect(formatMoney(-150)).toBe("-£1.50");
    expect(formatMoney(1000, { currency: "JPY", locale: "en-GB" })).toBe("JP¥1,000");
    expect(formatMoney(Number.NaN)).toBe("");
    expect(formatMoney(undefined)).toBe("");
    expect(minorUnitScale("GBP")).toBe(100);
    expect(minorUnitScale("JPY")).toBe(1);
  });

  test("money input parses to integer minor units", () => {
    expect(parseMoney("£1,250.50")).toBe(125050);
    expect(parseMoney("1250.5")).toBe(125050);
    expect(parseMoney("1250")).toBe(125000);
    expect(parseMoney("0.005")).toBe(1);
    expect(parseMoney("-£3.10")).toBe(-310);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("1.2.3")).toBeNaN();
    expect(parseMoney("1000", { currency: "JPY" })).toBe(1000);
    expect(parseMoney(".5")).toBe(50);
  });

  test("percentages", () => {
    expect(formatPercent(0.29556)).toBe("29.6%");
    expect(formatPercent(null)).toBe("");
  });
});
