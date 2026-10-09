// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { eventNames, openHarness } from "./support/page.js";

/**
 * Touch drags. Chromium gets trusted touch input through CDP
 * (Input.dispatchTouchEvent). WebKit has no CDP, so the iPad project
 * dispatches a synthetic PointerEvent sequence; real iPad behaviour is on the
 * manual checklist (docs/testing/manual-a11y.md).
 */
async function touchDrag(page, browserName, from, to) {
  if (browserName === "chromium") {
    const client = await page.context().newCDPSession(page);
    const point = (x, y) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: point(from.x, from.y),
    });
    for (let step = 1; step <= 8; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / 8;
      const y = from.y + ((to.y - from.y) * step) / 8;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(x, y),
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return;
  }
  await page.evaluate(
    async ({ from, to }) => {
      const target = document.elementFromPoint(from.x, from.y);
      const svg = target.closest("svg");
      const base = {
        bubbles: true,
        cancelable: true,
        pointerId: 11,
        pointerType: "touch",
        isPrimary: true,
      };
      target.dispatchEvent(
        new PointerEvent("pointerdown", { ...base, clientX: from.x, clientY: from.y }),
      );
      for (let step = 1; step <= 8; step += 1) {
        svg.dispatchEvent(
          new PointerEvent("pointermove", {
            ...base,
            clientX: from.x + ((to.x - from.x) * step) / 8,
            clientY: from.y + ((to.y - from.y) * step) / 8,
          }),
        );
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      svg.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: to.x, clientY: to.y }));
    },
    { from, to },
  );
}

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
