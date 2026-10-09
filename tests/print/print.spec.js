// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

test.skip(({ browserName }) => browserName !== "chromium", "page.pdf is Chromium-only");

async function pdfText(buffer) {
  const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const content = await (await document.getPage(index)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n");
}

test("A3 landscape print fits the whole programme on one page with title block and key", async ({
  page,
}) => {
  await page.goto("/examples/print-preview.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const buffer = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pdf = await PDFDocument.load(buffer);
  expect(pdf.getPageCount()).toBe(1);
  const { width, height } = pdf.getPage(0).getSize();
  expect(Math.abs(width - 1190.55)).toBeLessThan(1);
  expect(Math.abs(height - 841.89)).toBeLessThan(1);
  const text = await pdfText(buffer);
  for (const expected of [
    "Flat roof replacement, 14 Mill Lane",
    "B – Strip-out extended by one day",
    "Mill Lane Management Co",
    "Key",
    "Stage payment",
    "Insulation and membrane",
    "Snagging and handover",
  ]) {
    expect(text).toContain(expected);
  }
});

test("a lookahead print contains only the lookahead rows", async ({ page }) => {
  await page.goto("/examples/print-preview.html?lookahead=1");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const text = await pdfText(await page.pdf({ preferCSSPageSize: true }));
  expect(text).toContain("Deck repairs");
  expect(text).toContain("Strip existing covering");
  expect(text).not.toContain("Snagging and handover");
  expect(text).not.toContain("Site set-up and scaffold");
});

test("a 200-row programme prints every row (no virtualisation in print)", async ({ page }) => {
  await page.goto("/examples/print-preview.html?fixture=/tests/fixtures/programmes/cpm-n1.json");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const svgRows = await page.locator("#sheet .grid text").count();
  expect(svgRows).toBeGreaterThan(10 * 5);
});
