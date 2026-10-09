// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eventNames, openHarness, watchErrors } from "./support/page.js";
import { touchDrag } from "./support/touch.js";

/**
 * The phone experience (ADR-0011) on the touch projects: Pixel 7 (Chromium),
 * iPhone 15 and iPad (WebKit). The sample is the website's 14-row office
 * fit-out, in the timeline layout fitted to the width, embedded 420 px tall.
 */
const SAMPLE = {
  fixture: "/tests/fixtures/programmes/office-fit-out-sa446.json",
  layout: "timeline",
  fit: "width",
  height: "420px",
  mobile: true,
};

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** @param {import("@playwright/test").Page} page */
async function axe(page, selector) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(TAGS).analyze();
  return results.violations.map((violation) => violation.id);
}

/** @param {import("@playwright/test").Page} page */
const isPhone = (page) => page.viewportSize().width < 600;

/**
 * Swaps the viewport's width and height. Chromium will not resize a window
 * in native fullscreen, so that is left first, as a system back gesture
 * would; the chart's own full-viewport dialog stays open.
 * @param {import("@playwright/test").Page} page
 */
async function rotate(page) {
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width: height, height: width });
}

/**
 * True when Chromium (Android) entered native fullscreen; WebKit (iPhone,
 * iPad) has no element fullscreen to use, so it passes there.
 * @param {import("@playwright/test").Page} page
 * @param {string} browserName
 */
async function usedFullscreenApiWherePossible(page, browserName) {
  if (browserName !== "chromium") return true;
  return page.evaluate(() =>
    window.events.some((event) => event.type === "fullscreen-change" && event.native),
  );
}

/**
 * The rail runs down the side in landscape and across the top in portrait.
 * @param {import("@playwright/test").Page} page
 */
async function railFollowsTheLongEdge(page) {
  const rail = await page.locator(".sg-rail").boundingBox();
  const { width, height } = page.viewportSize();
  return width > height ? rail.height > rail.width : rail.width > rail.height;
}

/** @param {import("@playwright/test").Page} page */
const sheet = (page) => page.locator("dialog.sg-sheet");

/**
 * Taps a bar to select it, then drags it one week later with touch.
 * @param {import("@playwright/test").Page} page
 * @param {string} browserName
 */
async function dragStripOutOneWeek(page, browserName) {
  const bar = page.locator('[data-task-id="strip"] .sg-hit');
  await bar.tap();
  await expect.poll(() => page.evaluate(() => window.gantt.getSelection())).toEqual(["strip"]);
  const box = await bar.boundingBox();
  const week = await page.evaluate(() => window.gantt.scale.dayWidth * 7);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touchDrag(page, browserName, from, { x: from.x + week, y: from.y });
  await expect
    .poll(() => page.evaluate(() => window.gantt.getTask("strip").start))
    .toBe("2027-03-10");
}

test("phone: portrait summary, open, rotate to landscape, drag a bar, close", async ({
  page,
  browserName,
}) => {
  test.skip(!isPhone(page), "phones only");
  const { assertClean } = watchErrors(page);
  await openHarness(page, SAMPLE);
  const preview = page.locator(".sg-preview");
  await expect(preview).toBeVisible();
  await expect(page.locator(".sg-root.sg-preview + .sg-root")).toBeHidden();
  await expect(preview.locator(".sg-preview-list > li")).toHaveCount(14);
  expect(
    await preview.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
  ).toBe(true);
  expect(await axe(page, ".sg-preview")).toEqual([]);

  await preview.getByRole("button", { name: "Open the chart" }).tap();
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Close the chart" })).toBeFocused();
  await expect(page.locator(".sg-rotate-hint")).toBeVisible();
  await expect.poll(() => usedFullscreenApiWherePossible(page, browserName)).toBe(true);

  await rotate(page);
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator(".sg-rotate-hint")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const gantt = window.gantt;
        const needed = gantt.rows().length * gantt.rowHeight + gantt.headerHeight;
        return needed <= gantt.scroller.clientHeight || gantt.rowHeight === 24;
      }),
    )
    .toBe(true);
  expect(await axe(page, "dialog.sg-sheet")).toEqual([]);

  await dragStripOutOneWeek(page, browserName);
  expect((await eventNames(page)).filter((name) => name === "change")).toHaveLength(1);

  await page.getByRole("button", { name: "Close the chart" }).tap();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator(".sg-fullscreen")).toHaveCount(0);
  const modes = await page.evaluate(() =>
    window.events.filter((event) => event.type === "layout-change").map((event) => event.mode),
  );
  expect(modes).toEqual(["preview", "fullscreen", "inline"]);
  const fullscreen = await page.evaluate(() =>
    window.events.filter((event) => event.type === "fullscreen-change").map((event) => event.open),
  );
  expect(fullscreen.at(0)).toBe(true);
  expect(fullscreen.at(-1)).toBe(false);

  await rotate(page);
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-task-id="strip"] .sg-preview-dates')).toContainText("10 Mar");
  assertClean();
});

test("tablet: inline chart, expand, drag a bar, close", async ({ page, browserName }) => {
  test.skip(isPhone(page), "tablets only");
  await openHarness(page, SAMPLE);
  await expect(page.locator(".sg-preview")).toBeHidden();
  await page.getByRole("button", { name: "Open the chart full screen" }).tap();
  await expect(sheet(page)).toBeVisible();
  await dragStripOutOneWeek(page, browserName);
  await page.getByRole("button", { name: "Close the chart" }).tap();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Open the chart full screen" })).toBeVisible();
});

test("rotating while open keeps the chart open and refits the rows", async ({ page }) => {
  await openHarness(page, SAMPLE);
  await page.evaluate(() => window.gantt.mobile.open());
  await expect(sheet(page)).toBeVisible();
  const tallRows = (await page.evaluate(() => window.gantt.rowHeight)) === 44;
  const before = await page.evaluate(() => window.gantt.rowHeight);
  await rotate(page);
  await expect
    .poll(async () => tallRows || (await page.evaluate(() => window.gantt.rowHeight)) !== before)
    .toBe(true);
  await expect(sheet(page)).toBeVisible();
  expect(await railFollowsTheLongEdge(page)).toBe(true);
});

test("touch targets: bars are row-high and at least 44 px wide; rail buttons are 44 px", async ({
  page,
}) => {
  await openHarness(page, SAMPLE);
  await page.evaluate(() => window.gantt.mobile.open());
  await expect(sheet(page)).toBeVisible();
  const rowHeight = await page.evaluate(() => window.gantt.rowHeight);
  for (const id of ["setup", "pay-strip"]) {
    const box = await page.locator(`[data-task-id="${id}"] .sg-hit`).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(rowHeight - 1);
  }
  const close = await page.getByRole("button", { name: "Close the chart" }).boundingBox();
  expect(close.width).toBeGreaterThanOrEqual(43.5);
  expect(close.height).toBeGreaterThanOrEqual(43.5);
});

test("the editor is a full-width sheet on a phone, with inputs that do not zoom", async ({
  page,
}) => {
  test.skip(!isPhone(page), "phones only");
  await openHarness(page, SAMPLE);
  await page.evaluate(() => window.gantt.mobile.open());
  await expect(sheet(page)).toBeVisible();
  await page.evaluate(() => window.gantt.openEditor("strip"));
  const editor = page.locator("dialog.sg-dialog");
  await expect(editor).toBeVisible();
  const box = await editor.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(2);
  const sizes = await editor
    .locator("input, select, textarea")
    .evaluateAll((elements) =>
      elements.map((element) => parseFloat(getComputedStyle(element).fontSize)),
    );
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  expect(await axe(page, "dialog.sg-dialog")).toEqual([]);
  await page.getByRole("button", { name: "Cancel" }).tap();
  await expect(editor).toBeHidden();
  await expect(sheet(page)).toBeVisible();
});
