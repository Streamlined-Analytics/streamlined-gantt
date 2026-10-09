// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { dateX, eventNames, openHarness, watchErrors } from "./support/page.js";

test.describe("timeline layout, fitted to the width", () => {
  test("dragging a bar moves the task and fires drag-end, change and an updated summary", async ({
    page,
  }) => {
    const { assertClean } = watchErrors(page);
    await openHarness(page, { layout: "timeline", fit: "width", fields: true });
    expect(
      await page.evaluate(
        () => window.gantt.scroller.scrollWidth <= window.gantt.scroller.clientWidth,
      ),
    ).toBe(true);
    const before = await page.evaluate(() => window.gantt.getProjectSummary().finish);
    const bar = page.locator('[data-task-id="t3"] .sg-hit');
    const box = await bar.boundingBox();
    const startX = box.x + box.width / 2;
    const target = startX + ((await dateX(page, "2026-11-17")) - (await dateX(page, "2026-11-10")));
    await page.mouse.move(startX, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.gantt.getTask("t3").start))
      .toBe("2026-11-17");
    const names = await eventNames(page);
    expect(names.filter((name) => name === "change")).toHaveLength(1);
    expect(names).toContain("drag-move");
    expect(names.indexOf("drag-start")).toBeLessThan(names.indexOf("drag-end"));
    const after = await page.evaluate(() => window.gantt.getProjectSummary().finish);
    expect(after > before).toBe(true);
    expect(
      await page.evaluate(
        () => window.gantt.scroller.scrollWidth <= window.gantt.scroller.clientWidth,
      ),
    ).toBe(true);
    assertClean();
  });

  test("the keyboard reaches the bars: Tab, arrows and Alt+Right move a task", async ({ page }) => {
    await openHarness(page, { layout: "timeline", fit: "width" });
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const focused = await page.evaluate(() => window.gantt.focus.taskId);
    await expect(page.locator(`.sg-svg [data-task-id="${focused}"]`)).toHaveClass(/sg-focused/);
    const start = await page.evaluate((id) => window.gantt.getTask(id).start, focused);
    await page.keyboard.press("Alt+ArrowRight");
    await expect
      .poll(() => page.evaluate((id) => window.gantt.getTask(id).start, focused))
      .not.toBe(start);
    await page.keyboard.press("Control+z");
    await expect
      .poll(() => page.evaluate((id) => window.gantt.getTask(id).start, focused))
      .toBe(start);
  });

  test("resizing the window refits the programme", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openHarness(page, { layout: "timeline", fit: "width" });
    const wide = await page.evaluate(() => window.gantt.scale.dayWidth);
    await page.setViewportSize({ width: 640, height: 800 });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const { scroller } = window.gantt;
          return scroller.scrollWidth <= scroller.clientWidth
            ? window.gantt.scale.dayWidth
            : Infinity;
        }),
      )
      .toBeLessThan(wide);
  });
});
