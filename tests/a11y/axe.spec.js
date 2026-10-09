// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openHarness } from "../e2e/support/page.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page) {
  const results = await new AxeBuilder({ page }).include(".sg-root").withTags(TAGS).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes
        .map((node) => node.target.join(" "))
        .slice(0, 3)
        .join(", ")}`,
  );
}

test("no axe violations: default view", async ({ page }) => {
  await openHarness(page, { fields: true, baseline: "bl1" });
  expect(await scan(page)).toEqual([]);
});

test("no axe violations: timeline layout fitted to the width", async ({ page }) => {
  await openHarness(page, { layout: "timeline", fit: "width", fields: true });
  await page.keyboard.press("Tab");
  expect(await scan(page)).toEqual([]);
});

test("no axe violations: read-only, day zoom", async ({ page }) => {
  await openHarness(page, { readOnly: true, zoom: "day" });
  expect(await scan(page)).toEqual([]);
});

test("no axe violations: 1,000 tasks scrolled to row 500", async ({ page }) => {
  await openHarness(page, { fixture: "perf" });
  await page.evaluate(() => {
    window.gantt.scroller.scrollTop = 500 * 32;
    window.gantt.render();
  });
  expect(await scan(page)).toEqual([]);
});

test("no axe violations: forced colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openHarness(page);
  expect(await scan(page)).toEqual([]);
});

for (const preset of ["dark", "brand", "daisyui"]) {
  test(`no axe violations, colour contrast included: ${preset} theme`, async ({ page }) => {
    await page.goto(`/examples/theme-playground.html?preset=${preset}&bare`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    expect(await scan(page)).toEqual([]);
  });
}

test("no axe violations: dark mode from the operating system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openHarness(page, { fields: true });
  expect(await page.evaluate(() => getComputedStyle(window.gantt.root).colorScheme)).toBe("dark");
  expect(await scan(page)).toEqual([]);
});

test("exactly one tab stop and treegrid ARIA", async ({ page }) => {
  await openHarness(page);
  await expect(page.locator(".sg-root [tabindex='0']")).toHaveCount(1);
  const grid = page.getByRole("treegrid", { name: "Programme tasks" });
  await expect(grid).toHaveAttribute("aria-rowcount", "14");
  await expect(page.getByRole("row", { name: /Roofing works/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("drag handles are at least 24 px on touch screens (WCAG 2.5.8)", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();
  await openHarness(page);
  await page.locator('[data-task-id="t5"] .sg-hit').tap();
  const box = await page.locator('[data-task-id="t5"] [data-handle="resize-end"]').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
  await context.close();
});

test("no axe violations: inline chart with the mobile expand button", async ({ page }) => {
  await openHarness(page, { layout: "timeline", fit: "width", mobile: true });
  await expect(page.getByRole("button", { name: "Open the chart full screen" })).toBeVisible();
  expect(await scan(page)).toEqual([]);
});

test("no axe violations: the phone summary and the full-screen chart at phone sizes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHarness(page, { layout: "timeline", fit: "width", mobile: true });
  await expect(page.locator(".sg-preview")).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "Open the chart full screen" }).click();
  await expect(page.locator(".sg-root.sg-fullscreen")).toBeVisible();
  expect(await scan(page)).toEqual([]);
});
