// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { openHarness } from "../e2e/support/page.js";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-09T09:00:00Z"));
});

const chart = (page) => page.locator(".sg-root");

for (const type of ["FS", "SS", "FF", "SF"]) {
  test(`link routing ${type}`, async ({ page }) => {
    await openHarness(page, {
      fixture: `/tests/fixtures/programmes/link-${type}.json`,
      zoom: "day",
      height: "220px",
      columns: "name",
    });
    await expect(chart(page)).toHaveScreenshot(`link-${type}.png`);
  });
}

test("flat roof: milestones, payments with values, baseline ghost bars and variance", async ({
  page,
}) => {
  await openHarness(page, {
    baseline: "bl1",
    columns: "wbs,name,start,finish,duration,variance",
    height: "520px",
  });
  await expect(chart(page)).toHaveScreenshot("flat-roof-week.png");
});

test("critical path styling", async ({ page }) => {
  await openHarness(page, {
    fixture: "/tests/fixtures/programmes/cpm-n1.json",
    autoSchedule: "propagate",
    zoom: "day",
    columns: "name",
  });
  await page.evaluate(() => window.gantt.schedule().result);
  await expect(chart(page)).toHaveScreenshot("critical-path.png");
});

test("non-working shading across Christmas at day zoom", async ({ page }) => {
  await openHarness(page, {
    fixture: "/tests/fixtures/programmes/cpm-n1-christmas.json",
    zoom: "day",
    columns: "name",
  });
  await page.evaluate(() => window.gantt.schedule().result);
  await expect(chart(page)).toHaveScreenshot("christmas-day-zoom.png");
});

test("month zoom headers", async ({ page }) => {
  await openHarness(page, { zoom: "month", columns: "name" });
  await expect(chart(page)).toHaveScreenshot("month-zoom.png");
});

test("read-only view", async ({ page }) => {
  await openHarness(page, { readOnly: true, columns: "name,start,finish" });
  await expect(chart(page)).toHaveScreenshot("read-only.png");
});

test("forced colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openHarness(page, { columns: "name" });
  await expect(chart(page)).toHaveScreenshot("forced-colours.png");
});
