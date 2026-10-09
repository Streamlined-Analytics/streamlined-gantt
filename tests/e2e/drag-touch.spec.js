// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { eventNames, openHarness } from "./support/page.js";
import { touchDrag } from "./support/touch.js";

test("tap selects a bar, then a touch drag moves it", async ({ page, browserName }) => {
  await openHarness(page);
  const bar = page.locator('[data-task-id="t5"] .sg-hit');
  await bar.tap();
  await expect.poll(() => page.evaluate(() => window.gantt.getSelection())).toEqual(["t5"]);
  const box = await bar.boundingBox();
  const from = { x: box.x + 10, y: box.y + box.height / 2 };
  await touchDrag(page, browserName, from, { x: from.x + 2 * 12, y: from.y });
  await expect.poll(() => page.evaluate(() => window.gantt.getTask("t5").start)).toBe("2026-11-16");
});

test("a 4 px wiggle is not a drag", async ({ page, browserName }) => {
  await openHarness(page);
  const bar = page.locator('[data-task-id="t5"] .sg-hit');
  await bar.tap();
  const box = await bar.boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touchDrag(page, browserName, from, { x: from.x + 4, y: from.y });
  expect(await eventNames(page)).not.toContain("drag-start");
});

test("a vertical swipe over unselected bars does not start a drag", async ({
  page,
  browserName,
}) => {
  await openHarness(page, { fixture: "perf" });
  const bar = page.locator(".sg-layer-tasks > g .sg-hit").nth(3);
  const box = await bar.boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touchDrag(page, browserName, from, { x: from.x, y: from.y - 200 });
  expect(await eventNames(page)).not.toContain("drag-start");
});
