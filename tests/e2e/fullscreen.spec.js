// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { openHarness, watchErrors } from "./support/page.js";

/**
 * Full screen on a desktop (ADR-0011): the expand button and F use the
 * Fullscreen API on the chart's stage where the browser allows it, else the
 * full-viewport dialog; Escape returns; the chart refits to the screen.
 */
const SAMPLE = {
  fixture: "/tests/fixtures/programmes/office-fit-out-sa446.json",
  layout: "timeline",
  height: "420px",
  zoom: "day",
  mobile: true,
};

/**
 * Chromium grants element fullscreen to a click; headless WebKit may not, and
 * then the dialog fallback is what a user gets.
 * @param {import("@playwright/test").Page} page
 */
function fullscreenTarget(page) {
  return page.evaluate(() => {
    const element = document.fullscreenElement;
    if (element) return element.className;
    return document.querySelector("dialog.sg-sheet")?.open ? "dialog" : "none";
  });
}

test("the expand button opens the chart full screen, fitted, and Escape returns", async ({
  page,
  browserName,
}) => {
  const { assertClean } = watchErrors(page);
  await openHarness(page, SAMPLE);
  const expand = page.getByRole("button", { name: "Open the chart full screen" });
  await expand.click();
  const chart = page.locator(".sg-root.sg-fullscreen");
  await expect(chart).toBeVisible();
  await expect
    .poll(() => fullscreenTarget(page))
    .toBe(browserName === "chromium" ? "sg-stage" : await fullscreenTarget(page));
  const state = await page.evaluate(() => {
    const gantt = window.gantt;
    return {
      fit: gantt.fitWidth,
      rowsFit:
        gantt.rows().length * gantt.rowHeight + gantt.headerHeight <= gantt.scroller.clientHeight,
      noSideScroll: gantt.scroller.scrollWidth <= gantt.scroller.clientWidth,
      width: gantt.root.getBoundingClientRect().width,
    };
  });
  expect(state).toMatchObject({ fit: true, rowsFit: true, noSideScroll: true });
  expect(state.width).toBeGreaterThan(1200);
  await expect(page.getByRole("button", { name: "Close the chart" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(chart).toHaveCount(0);
  await expect.poll(() => fullscreenTarget(page)).toBe("none");
  await expect(expand).toBeFocused();
  expect(await page.evaluate(() => [window.gantt.fitWidth, window.gantt.zoom])).toEqual([
    false,
    "day",
  ]);
  const opened = await page.evaluate(() =>
    window.events.filter((event) => event.type === "fullscreen-change").map((event) => event.open),
  );
  expect(opened).toEqual([true, false]);
  assertClean();
});

test("F toggles full screen from the chart's keyboard focus", async ({ page }) => {
  await openHarness(page, SAMPLE);
  await page.keyboard.press("Tab");
  await page.keyboard.press("f");
  await expect(page.locator(".sg-root.sg-fullscreen")).toBeVisible();
  await page.keyboard.press("f");
  await expect(page.locator(".sg-root.sg-fullscreen")).toHaveCount(0);
});

test("the JavaScript API: toggleFullscreen and isFullscreen", async ({ page }) => {
  await openHarness(page, SAMPLE);
  await page.evaluate(() => window.gantt.toggleFullscreen());
  expect(await page.evaluate(() => window.gantt.isFullscreen)).toBe(true);
  await page.evaluate(() => window.gantt.exitFullscreen());
  expect(await page.evaluate(() => window.gantt.isFullscreen)).toBe(false);
});
