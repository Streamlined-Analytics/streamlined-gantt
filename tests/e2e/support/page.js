// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect } from "@playwright/test";

/**
 * Opens the harness and waits until the chart is ready.
 * @param {import("@playwright/test").Page} page
 * @param {Record<string, string|boolean>} [query]
 */
export async function openHarness(page, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    params.set(key, value === true ? "" : String(value));
  await page.goto(`/examples/harness.html?${params}`);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
}

/**
 * Collects page errors and console errors; call `assertClean()` at the end.
 * @param {import("@playwright/test").Page} page
 */
export function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { errors, assertClean: () => expect(errors).toEqual([]) };
}

/**
 * The client x of the left edge of an ISO date column.
 * @param {import("@playwright/test").Page} page
 * @param {string} iso
 */
export async function dateX(page, iso) {
  return page.evaluate((date) => {
    const gantt = window.gantt;
    const [year, month, day] = date.split("-").map(Number);
    const dayNumber = Date.UTC(year, month - 1, day) / 86400000;
    const rect = gantt.timeline.svg.getBoundingClientRect();
    return rect.left + gantt.scale.x(dayNumber);
  }, iso);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} name event name
 */
export async function eventNames(page) {
  return page.evaluate(() => window.events.map((event) => event.type));
}
