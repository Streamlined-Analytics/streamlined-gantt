// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { watchErrors } from "./support/page.js";

const echarts = readFileSync(
  new URL("../../node_modules/echarts/dist/echarts.min.js", import.meta.url),
);

test.beforeEach(async ({ page }) => {
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/echarts/**", (route) =>
    route.fulfill({
      body: echarts,
      contentType: "text/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
});

const pages = readdirSync(new URL("../../examples/", import.meta.url)).filter(
  (name) => name.endsWith(".html") && name !== "index.html",
);

for (const name of pages) {
  test(`example ${name} loads without errors`, async ({ page }) => {
    const { assertClean } = watchErrors(page);
    await page.goto(`/examples/${name}`);
    await expect(page.locator(".sg-root").first()).toBeVisible();
    assertClean();
  });
}

test("the script-tag build exposes the global and defines the element once", async ({ page }) => {
  const { assertClean } = watchErrors(page);
  await page.goto("/examples/iife.html");
  await expect(page.locator(".sg-root")).toBeVisible();
  const state = await page.evaluate(async () => {
    const before = customElements.get("streamlined-gantt");
    await import("/dist/streamlined-gantt.js").then((module) => module.defineElement());
    return {
      global: typeof window.StreamlinedGantt?.Gantt,
      same: customElements.get("streamlined-gantt") === before,
      rows: document.querySelectorAll(".sg-grid-body [role=row]").length,
    };
  });
  expect(state).toEqual({ global: "function", same: true, rows: 13 });
  assertClean();
});

test("the ES module build defines the element", async ({ page }) => {
  await page.goto("/examples/esm.html");
  await expect(page.locator(".sg-root")).toBeVisible();
  expect(
    await page.evaluate(() => Boolean(document.querySelector("streamlined-gantt").gantt)),
  ).toBe(true);
});
