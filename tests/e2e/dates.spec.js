// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { dateX, openHarness } from "./support/page.js";

test("every day column has the same width across the October clock change", async ({ page }) => {
  await openHarness(page, { zoom: "day" });
  const widths = await page.evaluate(() => {
    const gantt = window.gantt;
    const start = Date.UTC(2026, 9, 19) / 86400000;
    return Array.from(
      { length: 14 },
      (_, offset) => gantt.scale.x(start + offset + 1) - gantt.scale.x(start + offset),
    );
  });
  expect(new Set(widths).size).toBe(1);
});

test("a task starting 2 November renders in the 2 November column in any time zone", async ({
  page,
}) => {
  await openHarness(page, { zoom: "day" });
  const x = await page
    .locator('[data-task-id="t1"] .sg-bar')
    .evaluate((node) => node.getBoundingClientRect().left);
  expect(Math.abs(x - (await dateX(page, "2026-11-02")))).toBeLessThan(1.5);
  await expect(page.locator('[data-task-id="t1"] [role=gridcell]').nth(2)).toHaveText("02/11/2026");
});
