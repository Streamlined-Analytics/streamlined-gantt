// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { dateX } from "./support/page.js";

const echarts = readFileSync(
  new URL("../../node_modules/echarts/dist/echarts.min.js", import.meta.url),
);

test.beforeEach(async ({ page }) => {
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/echarts/6.1.0/echarts.min.js", (route) =>
    route.fulfill({
      body: echarts,
      contentType: "text/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
});

test("the summary table and charts update live during a drag and once per committed change", async ({
  page,
}) => {
  await page.goto("/examples/echarts-summary.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const kpi = (label) => page.locator(".kpis tr", { hasText: label }).locator("td");
  await expect(kpi("Duration")).toHaveText("20 working days (2026-11-02 to 2026-11-27)");
  await expect(kpi("Total cost")).toHaveText("£12,680.00");
  await expect(kpi("Profit")).toHaveText("£5,320.00 (29.6%)");
  await expect(kpi("Float to completion date")).toHaveText("5 working days");
  const before = await page.evaluate(() => ({ ...window.summaryRenders }));
  const bar = page.locator('[data-task-id="t3"] .sg-hit');
  const box = await bar.boundingBox();
  const shift = (await dateX(page, "2026-11-17")) - (await dateX(page, "2026-11-10"));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + shift, box.y + box.height / 2, { steps: 8 });
  await expect(kpi("Float to completion date")).toHaveText("0 working days");
  await page.mouse.up();
  await expect(kpi("Duration")).toHaveText("25 working days (2026-11-02 to 2026-12-04)");
  const after = await page.evaluate(() => ({ ...window.summaryRenders }));
  expect(after.change - before.change).toBe(1);
  expect(after.preview - before.preview).toBeGreaterThan(0);
  const option = await page.evaluate(() =>
    window.echarts
      .getInstanceByDom(document.getElementById("cashflow"))
      .getOption()
      .series[1].data.at(-1),
  );
  expect(option).toBe(18000);
});
