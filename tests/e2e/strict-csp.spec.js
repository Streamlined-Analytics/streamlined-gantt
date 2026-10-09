// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { watchErrors } from "./support/page.js";

test("works under a strict CSP: no inline script or style, no eval", async ({ page }) => {
  const { assertClean } = watchErrors(page);
  const response = await page.goto("/examples/strict-csp.html");
  expect(response?.headers()["content-security-policy"]).toContain("style-src 'self'");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(async () => {
    const gantt = window.gantt;
    gantt.setTheme({ bar: "#0f766e", rowAlt: "#f8fafc" });
    const [firstLink] = gantt.store.list("links");
    await gantt.updateLink(firstLink.id, { style: { color: "#db2777" } });
    await gantt.updateTask("t3", { start: "2026-11-11" });
    gantt.openEditor("t3");
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('g[data-task-id="t5"] .sg-hit').hover();
  await page.locator('g[data-task-id="t5"] .sg-hit').click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  assertClean();
});
