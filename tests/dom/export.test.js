// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { generatePerfProgramme } from "../fixtures/perf/generate-perf-fixture.js";
import { Gantt } from "../../src/index.js";
import { installPrint, printDocumentHTML } from "../../src/print/index.js";
import { cleanup, mount } from "./support.js";

beforeAll(() => installPrint(Gantt));
afterEach(cleanup);

describe("toSVG", () => {
  test("is a standalone, well-formed SVG with no external references", async () => {
    const { gantt } = mount(structuredClone(flatRoof));
    const markup = gantt.toSVG();
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    const root = parsed.documentElement;
    expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    expect(root.getAttribute("viewBox")).toMatch(/^0 0 \d+(\.\d+)? \d+$/);
    expect(markup).not.toMatch(/href="(https?:|\/)/);
    expect(markup).not.toContain("var(--");
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    await image.decode();
    expect(image.naturalWidth).toBeGreaterThan(500);
  });

  test("contains every task, payment values and the title block", () => {
    const { gantt } = mount(structuredClone(flatRoof));
    const markup = gantt.toSVG({
      titleBlock: { client: "Main Co & Sons <Ltd>", status: "Tender" },
    });
    for (const task of flatRoof.tasks)
      expect(markup).toContain(task.name.slice(0, 12).replace("&", "&amp;"));
    expect(markup).toContain("£9,000.00");
    expect(markup).toContain("Main Co &amp; Sons &lt;Ltd&gt;");
    expect(markup).toContain("Tender");
  });

  test("renders all 1,000 rows, not just the visible window", () => {
    const { gantt } = mount(generatePerfProgramme({ phases: 10 }));
    const element = new DOMParser().parseFromString(
      gantt.toSVG({ zoom: "month" }),
      "image/svg+xml",
    );
    expect(element.querySelectorAll(".grid text").length).toBeGreaterThanOrEqual(200 * 5);
  });

  test("print document HTML sets the page size and escapes the title", () => {
    const programme = structuredClone(flatRoof);
    programme.name = "Roof <b>&</b>";
    const { gantt } = mount(programme);
    const html = printDocumentHTML(gantt, { paper: "A4", orientation: "portrait" });
    expect(html).toContain("@page{size:A4 portrait;margin:8mm}");
    expect(html).toContain("<title>Roof &lt;b&gt;&amp;&lt;/b&gt;</title>");
  });
});

describe("exportPNG", () => {
  test("returns a PNG blob at the requested scale", async () => {
    const { gantt } = mount(structuredClone(flatRoof));
    const blob = await gantt.exportPNG({ scale: 1, legend: false, titleBlock: false });
    expect(blob.type).toBe("image/png");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const bitmap = await createImageBitmap(blob);
    const svgWidth = Number(
      new DOMParser()
        .parseFromString(gantt.toSVG({ legend: false, titleBlock: false }), "image/svg+xml")
        .documentElement.getAttribute("width"),
    );
    expect(bitmap.width).toBe(Math.ceil(svgWidth));
  });
});
