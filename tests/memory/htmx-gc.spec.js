// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "page.requestGC and CDP are Chromium-only",
);

test("50 htmx swaps: every instance is garbage-collectable and DOM listener counts return to baseline", async ({
  page,
}) => {
  await page.goto("/examples/htmx-swap.html");
  const client = await page.context().newCDPSession(page);
  const counters = async () => (await client.send("Memory.getDOMCounters")).jsEventListeners;
  await page.evaluate(() => {
    window.instances = [];
    document.addEventListener("gantt:load", (event) =>
      window.instances.push(new WeakRef(event.target.gantt)),
    );
  });
  const cycle = async () => {
    await page.locator("#show").click();
    await expect(page.locator(".sg-root")).toBeVisible();
    await page.locator("#hide").click();
    await expect(page.locator(".sg-root")).toHaveCount(0);
  };
  await cycle();
  await page.requestGC();
  const baseline = await counters();
  for (let index = 0; index < 50; index += 1) await cycle();
  await page.requestGC();
  await page.requestGC();
  const alive = await page.evaluate(
    () => window.instances.filter((ref) => ref.deref() !== undefined).length,
  );
  expect(alive).toBe(0);
  expect(await counters()).toBeLessThanOrEqual(baseline + 2);
});
