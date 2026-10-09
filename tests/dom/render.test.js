// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test, vi } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import christmas from "../fixtures/programmes/cpm-n1-christmas.json";
import { generatePerfProgramme } from "../fixtures/perf/generate-perf-fixture.js";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";
import { cleanup, frame, mount } from "./support.js";

afterEach(cleanup);

describe("structure and ARIA", () => {
  test("renders a treegrid with the true row count and indices", () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { fields: FLAT_ROOF_FIELDS });
    const grid = host.querySelector("[role=treegrid]");
    expect(grid.getAttribute("aria-rowcount")).toBe(String(flatRoof.tasks.length + 1));
    const rows = [...grid.querySelectorAll("[role=rowgroup] [role=row][data-task-id]")];
    expect(rows.map((row) => row.getAttribute("aria-rowindex"))).toEqual(
      rows.map((_, index) => String(index + 2)),
    );
    const summary = grid.querySelector('[data-task-id="s2"]');
    expect(summary.getAttribute("aria-level")).toBe("1");
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(grid.querySelector('[data-task-id="t5"]').getAttribute("aria-level")).toBe("2");
    expect(grid.querySelector('[data-task-id="t5"]').hasAttribute("aria-expanded")).toBe(false);
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(host.querySelector(".sg-svg").getAttribute("aria-hidden")).toBe("true");
    void gantt;
  });

  test("cells show en-GB dates, money and computed margins", () => {
    const { host } = mount(structuredClone(flatRoof), { fields: FLAT_ROOF_FIELDS });
    const cells = [...host.querySelectorAll('[data-task-id="t5"] [role=gridcell]')].map(
      (cell) => cell.textContent,
    );
    expect(cells).toEqual([
      "2.4",
      "Insulation and membrane",
      "13/11/2026",
      "20/11/2026",
      "6",
      "£6,000.00",
      "£9,000.00",
      "33.3%",
    ]);
    const name = host.querySelector('[data-task-id="t5"] .sg-tree-cell');
    expect(name.getAttribute("aria-label")).toBe(
      "Insulation and membrane, Friday 13 November 2026 to Friday 20 November 2026, 6 working days",
    );
  });

  test("each task type renders its shape; payment milestones carry their value", () => {
    const { host } = mount(structuredClone(flatRoof));
    const svg = host.querySelector(".sg-svg");
    expect(svg.querySelector('[data-task-id="s2"] .sg-summary-shape')).not.toBeNull();
    expect(svg.querySelector('[data-task-id="s2"] [data-handle]')).toBeNull();
    expect(svg.querySelector('[data-task-id="p2"] .sg-milestone.sg-payment')).not.toBeNull();
    expect(svg.querySelector('[data-task-id="p2"] [data-handle^="resize"]')).toBeNull();
    expect(svg.querySelector('[data-task-id="p2"] .sg-bar-label').textContent).toContain(
      "£9,000.00",
    );
    expect(svg.querySelector('[data-task-id="a1"] .sg-flag.sg-access')).not.toBeNull();
    expect(svg.querySelector('[data-task-id="a1"] [data-handle]')).toBeNull();
    expect(svg.querySelectorAll('[data-task-id="t5"] [data-handle]')).toHaveLength(6);
    expect(svg.querySelectorAll(".sg-link")).toHaveLength(flatRoof.links.length);
    expect(
      svg.querySelector('[data-link-id="l5"] .sg-link-line').getAttribute("marker-end"),
    ).toMatch(/^url\(#sg\d+-arrow\)$/);
  });

  test("today, data date, completion and key-date markers are drawn at the right x", () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const scale = gantt.scale;
    const line = (kind) => Number(host.querySelector(`line.sg-marker-${kind}`).getAttribute("x1"));
    expect(line("data-date")).toBeCloseTo(scale.x(Date.UTC(2026, 10, 9) / 86400000), 1);
    expect(line("today")).toBeCloseTo(line("data-date"), 1);
    expect(line("completion")).toBeCloseTo(scale.x(Date.UTC(2026, 11, 5) / 86400000), 1);
    expect(line("key-date")).toBeCloseTo(scale.x(Date.UTC(2026, 10, 26) / 86400000), 1);
    expect(host.querySelector(".sg-marker-flag.sg-marker-key-date").textContent).toBe(
      "Key Date 1: watertight",
    );
  });

  test("non-working days and bank holidays are shaded at day zoom", () => {
    const { host, gantt } = mount(structuredClone(christmas), { zoom: "day" });
    const shaded = [...host.querySelectorAll(".sg-nonworking")].map((rect) =>
      Math.round(Number(rect.getAttribute("x")) / gantt.scale.dayWidth + gantt.scale.start),
    );
    const weekend = Date.UTC(2026, 11, 19) / 86400000;
    expect(shaded).toContain(weekend);
    expect(shaded).not.toContain(weekend + 2);
    gantt.scrollToDate("2026-12-24");
    const holidays = host.querySelectorAll(".sg-nonworking-bank-holiday");
    expect(holidays.length).toBeGreaterThan(0);
  });

  test("critical bars carry a non-colour cue", () => {
    const programme = structuredClone(flatRoof);
    delete programme.contractCompletion;
    const { host } = mount(programme);
    const critical = host.querySelector(".sg-task.sg-critical");
    expect(critical).not.toBeNull();
    expect(critical.querySelector(".sg-critical-overlay").getAttribute("fill")).toMatch(
      /^url\(#sg\d+-critical\)$/,
    );
    expect(getComputedStyle(critical.querySelector(".sg-bar")).strokeDasharray).not.toBe("none");
  });

  test("read-only mode renders no handles at all and marks the grid read-only", () => {
    const { host, gantt } = mount(structuredClone(flatRoof), { readOnly: true });
    expect(host.querySelectorAll("[data-handle]")).toHaveLength(0);
    expect(host.querySelector("[role=treegrid]").getAttribute("aria-readonly")).toBe("true");
    gantt.setReadOnly(false);
    expect(host.querySelectorAll("[data-handle]").length).toBeGreaterThan(0);
  });

  test("hidden columns are absent from the DOM", () => {
    const { host } = mount(structuredClone(flatRoof), {
      fields: FLAT_ROOF_FIELDS,
      hiddenColumns: ["fields.cost", "fields.margin"],
    });
    const headers = [...host.querySelectorAll("[role=columnheader]")].map(
      (header) => header.textContent,
    );
    expect(headers).toEqual(["WBS", "Task", "Start", "Finish", "Days", "Charge"]);
  });

  test("collapsing a summary hides its children and updates aria-expanded", async () => {
    const { host, gantt } = mount(structuredClone(flatRoof));
    const events = [];
    gantt.on("expand-change", (event) => events.push(event));
    gantt.collapse("s2");
    expect(host.querySelector('[data-task-id="t5"]')).toBeNull();
    expect(host.querySelector('[data-task-id="s2"][role=row]').getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(host.querySelector("[role=treegrid]").getAttribute("aria-rowcount")).toBe(
      String(flatRoof.tasks.length + 1 - 6),
    );
    host.querySelector('[data-task-id="s2"] [data-action=toggle]').click();
    await frame();
    expect(host.querySelector('[data-task-id="t5"]')).not.toBeNull();
    expect(events.map((event) => event.expanded)).toEqual([false, true]);
    gantt.collapseAll();
    expect(gantt.rows()).toHaveLength(3);
    gantt.expandAll();
    expect(gantt.rows()).toHaveLength(flatRoof.tasks.length);
  });
});

describe("virtualisation with 1,000 tasks and 1,500 links", () => {
  const rowBudget = Math.ceil(640 / 32) + 2 * 10 + 1;

  test("renders a bounded number of rows before and after scrolling", async () => {
    const { host, gantt } = mount(generatePerfProgramme(), { rowHeight: 32 });
    const count = () => [
      host.querySelectorAll(".sg-grid-body [role=row]").length,
      host.querySelectorAll(".sg-layer-tasks > g").length,
    ];
    expect(gantt.rows()).toHaveLength(1000);
    expect(host.querySelector("[role=treegrid]").getAttribute("aria-rowcount")).toBe("1001");
    for (const position of [0, 500 * 32, 999 * 32]) {
      gantt.scroller.scrollTop = position;
      gantt.render();
      const [gridRows, bars] = count();
      expect(gridRows).toBeLessThanOrEqual(rowBudget);
      expect(bars).toBeLessThanOrEqual(rowBudget);
      const indices = [...host.querySelectorAll(".sg-grid-body [role=row]")].map(
        (row) => Number(row.getAttribute("aria-rowindex")) - 2,
      );
      for (const index of indices)
        expect(gantt.rows()[index].id).toBe(
          host.querySelector(`.sg-grid-body [aria-rowindex="${index + 2}"]`).dataset.taskId,
        );
    }
  });

  test("a one-row scroll reuses rows instead of rebuilding them", () => {
    const { gantt } = mount(generatePerfProgramme(), { rowHeight: 32 });
    gantt.scroller.scrollTop = 3200;
    gantt.render();
    const spy = vi.spyOn(document, "createElement");
    gantt.scroller.scrollTop = 3232;
    gantt.render();
    const created = spy.mock.calls.length;
    spy.mockRestore();
    expect(created).toBeLessThanOrEqual(gantt.columns.length + 4);
  });

  test("links are drawn only when one end is in the rendered window", () => {
    const { host, gantt } = mount(generatePerfProgramme(), { rowHeight: 32 });
    const rendered = new Set(
      [...host.querySelectorAll(".sg-layer-tasks > g")].map((group) => group.dataset.taskId),
    );
    const drawn = [...host.querySelectorAll(".sg-link")].map((group) =>
      gantt.getLink(group.dataset.linkId),
    );
    expect(drawn.length).toBeGreaterThan(0);
    for (const link of drawn) expect(rendered.has(link.from) || rendered.has(link.to)).toBe(true);
    const expected = gantt
      .getLinks()
      .filter((link) => rendered.has(link.from) || rendered.has(link.to));
    expect(drawn).toHaveLength(expected.length);
  });

  test("no blank region after horizontal scrolling: visible tasks have bars in view", () => {
    const { host, gantt } = mount(generatePerfProgramme({ phases: 5 }), { zoom: "day" });
    const width = gantt.scroller.clientWidth - gantt.gridWidth();
    for (let left = 0; left < gantt.scale.width - width; left += width) {
      gantt.scroller.scrollLeft = left;
      gantt.render();
      const from = gantt.scale.dayAt(left);
      const to = gantt.scale.dayAt(left + width);
      for (const group of host.querySelectorAll(".sg-layer-tasks > g")) {
        const row = gantt.rowById(group.dataset.taskId);
        if (!row.dates || row.dates.finish < from || row.dates.start > to) continue;
        expect(group.querySelector(".sg-shape")).not.toBeNull();
      }
    }
  });

  test("first render stays within the generous CI budget", () => {
    const started = performance.now();
    const { gantt } = mount(generatePerfProgramme());
    const elapsed = performance.now() - started;
    console.info(
      `first render of 1,000 tasks: ${elapsed.toFixed(1)} ms (render pass ${gantt.firstRenderMs.toFixed(1)} ms)`,
    );
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("zoom and scrolling", () => {
  test("zoom keeps the centre date and emits zoom-change", () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const events = [];
    gantt.on("zoom-change", (event) => events.push(event));
    const centre = gantt.centreDay();
    gantt.setZoom("day");
    expect(Math.abs(gantt.centreDay() - centre)).toBeLessThanOrEqual(1);
    expect(host.querySelector(".sg-root").dataset.zoom).toBe("day");
    gantt.zoomOut();
    gantt.zoomOut();
    gantt.zoomIn();
    expect(events.map((event) => event.zoom)).toEqual(["day", "week", "month", "week"]);
    gantt.setZoom("nonsense");
    expect(gantt.zoom).toBe("week");
  });

  test("day zoom labels use w/c and day initials", () => {
    const { host } = mount(structuredClone(flatRoof), { zoom: "day" });
    const top = [...host.querySelectorAll(".sg-scale-top .sg-tick")].map(
      (tick) => tick.textContent,
    );
    const bottom = [...host.querySelectorAll(".sg-scale-bottom .sg-tick")].map(
      (tick) => tick.textContent,
    );
    expect(top).toContain("w/c 2 Nov 2026");
    expect(bottom).toContain("M 2");
  });

  test("scroll emits a debounced scroll event with the visible window", async () => {
    const { gantt } = mount(generatePerfProgramme({ phases: 10 }));
    const events = [];
    gantt.on("scroll", (event) => events.push(event));
    gantt.scroller.scrollTop = 640;
    gantt.scroller.dispatchEvent(new Event("scroll"));
    gantt.scroller.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events).toHaveLength(1);
    expect(events[0].firstRow).toBe(20);
    expect(events[0].fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("scrollToTask expands ancestors, scrolls and can select", () => {
    const { gantt } = mount(structuredClone(flatRoof));
    gantt.collapse("s3");
    gantt.scrollToTask("t8", { select: true });
    expect(gantt.rowById("t8")).toBeDefined();
    expect(gantt.getSelection()).toEqual(["t8"]);
    gantt.fitToRange("2026-11-02", "2026-11-13");
    expect(gantt.zoom).toBe("day");
  });

  test("filters and lookahead keep ancestors of matching tasks", () => {
    const { gantt } = mount(structuredClone(flatRoof));
    gantt.setFilter((task) => task.trade === "Carpentry");
    expect(gantt.rows().map((row) => row.id)).toEqual(["s2", "t3"]);
    gantt.setFilter(null);
    gantt.setLookahead({ weeks: 1, from: "2026-11-16" });
    expect(gantt.rows().map((row) => row.id)).toEqual(["s2", "t5"]);
    gantt.setLookahead(null);
    expect(gantt.rows()).toHaveLength(flatRoof.tasks.length);
  });
});
