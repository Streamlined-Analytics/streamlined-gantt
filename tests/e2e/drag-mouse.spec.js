// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { dateX, eventNames, openHarness, watchErrors } from "./support/page.js";

test.describe("mouse drag on the flat-roof job", () => {
  test("move: successors follow on working days; one change event", async ({ page }) => {
    const { assertClean } = watchErrors(page);
    await openHarness(page, { zoom: "day" });
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
    expect(await page.evaluate(() => window.gantt.getTask("t5").start)).toBe("2026-11-20");
    const names = await eventNames(page);
    expect(names.filter((name) => name === "change")).toHaveLength(1);
    expect(names.indexOf("drag-start")).toBeLessThan(names.indexOf("drag-end"));
    assertClean();
  });

  test("resize-end: the finish is the inclusive date of the column under the pointer", async ({
    page,
  }) => {
    await openHarness(page, { zoom: "week" });
    const handle = page.locator('[data-task-id="t5"] [data-handle="resize-end"]');
    const box = await handle.boundingBox();
    const target = ((await dateX(page, "2026-11-25")) + (await dateX(page, "2026-11-26"))) / 2;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.gantt.getTask("t5").finish))
      .toBe("2026-11-25");
  });

  test("releasing the mouse outside the window ends the drag and stops auto-scroll", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "firefox",
      "Playwright's Firefox delivers no input at all outside the viewport, not even the captured pointerup",
    );
    await openHarness(page, { zoom: "day" });
    const bar = page.locator('[data-task-id="t5"] .sg-hit');
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(-50, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => eventNames(page)).toContain("drag-end");
    const first = await page.evaluate(() => window.gantt.scroller.scrollLeft);
    await expect.poll(() => page.evaluate(() => window.gantt.pointer.dragging)).toBe(false);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(await page.evaluate(() => window.gantt.scroller.scrollLeft)).toBe(first);
  });

  test("Esc cancels a drag without any before event", async ({ page }) => {
    await openHarness(page);
    const bar = page.locator('[data-task-id="t5"] .sg-hit');
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    const names = await eventNames(page);
    expect(names).toContain("drag-end");
    expect(names).not.toContain("before-task-update");
    expect(await page.evaluate(() => window.gantt.getTask("t5").start)).toBe("2026-11-13");
  });

  test("read-only: no handles and no drag events", async ({ page }) => {
    await openHarness(page, { readOnly: true });
    await expect(page.locator("[data-handle]")).toHaveCount(0);
    const bar = page.locator('[data-task-id="t5"] .sg-bar');
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await eventNames(page)).not.toContain("drag-start");
  });

  test("dates render on the right day west of UTC (vis-timeline #663)", async ({ page }) => {
    await openHarness(page, { zoom: "day" });
    const cells = await page.locator('[data-task-id="t3"] [role=gridcell]').allTextContents();
    expect(cells.slice(2, 4)).toEqual(["10/11/2026", "12/11/2026"]);
    const barX = await page
      .locator('[data-task-id="t3"] .sg-bar')
      .evaluate((node) => node.getBoundingClientRect().left);
    expect(Math.abs(barX - (await dateX(page, "2026-11-10")))).toBeLessThan(1.5);
  });
});
