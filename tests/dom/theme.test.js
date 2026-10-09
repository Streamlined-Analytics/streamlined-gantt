// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { buildDocument } from "../../src/print/index.js";
import { cleanup, mount } from "./support.js";

afterEach(() => {
  cleanup();
  for (const element of document.querySelectorAll("[data-theme-test]")) element.remove();
});

const data = () => structuredClone(flatRoof);
const bar = (host, id) => host.querySelector(`g[data-task-id="${id}"] .sg-bar`);
const group = (host, id) => host.querySelector(`g[data-task-id="${id}"]`);
const fill = (element) => getComputedStyle(element).fill;
const token = (gantt, name) => getComputedStyle(gantt.root).getPropertyValue(name).trim();

/** Normalises any CSS colour to the browser's computed `rgb(...)` form. */
function rgb(colour) {
  const probe = document.createElement("span");
  probe.style.color = colour;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

/** Adds unlayered host CSS, as a site's own stylesheet would be. */
function hostCSS(text) {
  const style = document.createElement("style");
  style.dataset.themeTest = "";
  style.textContent = text;
  document.head.append(style);
}

describe("theme tokens from JavaScript", () => {
  test("options.theme and setTheme set tokens on the root; null removes them", () => {
    const { gantt, host } = mount(data(), { theme: { bar: "#0f766e" }, showCriticalPath: false });
    expect(gantt.root.style.getPropertyValue("--sg-bar")).toBe("#0f766e");
    expect(fill(bar(host, "t1"))).toBe(rgb("#0f766e"));
    gantt.setTheme({ "--sg-bar": "#7c3aed", barCritical: "#be123c", "row-alt": "#f5f3ff" });
    expect(fill(bar(host, "t1"))).toBe(rgb("#7c3aed"));
    expect(gantt.root.style.getPropertyValue("--sg-bar-critical")).toBe("#be123c");
    expect(gantt.root.style.getPropertyValue("--sg-row-alt")).toBe("#f5f3ff");
    gantt.setTheme({ bar: null });
    expect(gantt.root.style.getPropertyValue("--sg-bar")).toBe("");
    expect(fill(bar(host, "t1"))).toBe(rgb(token(gantt, "--sg-palette-primary")));
  });

  test("unlayered host CSS beats the library's layer without !important", () => {
    hostCSS(".sg-root { --sg-bar: rgb(1, 2, 3); } .sg-bar-label { fill: rgb(4, 5, 6); }");
    const { host } = mount(data(), { showCriticalPath: false });
    expect(fill(bar(host, "t1"))).toBe("rgb(1, 2, 3)");
    expect(fill(host.querySelector(".sg-bar-label"))).toBe("rgb(4, 5, 6)");
  });

  test("geometry tokens from CSS set row height, bar height and corner radius", () => {
    hostCSS(
      ".geometry-host .sg-root { --sg-row-height: 44px; --sg-bar-height: 12px; --sg-bar-radius: 0px; }",
    );
    const { gantt, host } = mount(data(), { showCriticalPath: false });
    expect(gantt.rowHeight).toBe(32);
    host.classList.add("geometry-host");
    gantt.refreshTheme();
    expect(gantt.rowHeight).toBe(44);
    const rect = bar(host, "t1");
    expect(rect.getAttribute("height")).toBe("12");
    expect(rect.getAttribute("rx")).toBe("0");
    expect(host.querySelector(".sg-grid-body > .sg-row").getBoundingClientRect().height).toBe(44);
    gantt.setTheme({ barRadius: "6px" });
    expect(bar(host, "t1").getAttribute("rx")).toBe("6");
  });

  test("options.rowHeight wins over the token", () => {
    const { gantt } = mount(data(), { rowHeight: 28, theme: { rowHeight: "50px" } });
    expect(gantt.rowHeight).toBe(28);
  });
});

describe("colour from data", () => {
  test("categories colour bars, with contrast-safe inside labels", () => {
    const programme = data();
    Object.assign(
      programme.tasks.find((task) => task.id === "t1"),
      { category: "Roofing", name: "Roof" },
    );
    Object.assign(
      programme.tasks.find((task) => task.id === "t2"),
      { category: "scaffold", name: "Scaff" },
    );
    const { gantt, host } = mount(programme, {
      showCriticalPath: false,
      barLabels: "inside",
      zoom: "day",
      categories: { roofing: "#c2410c", scaffold: { color: "#fde047", text: "#111111" } },
    });
    expect(group(host, "t1").classList.contains("sg-category-roofing")).toBe(true);
    expect(fill(bar(host, "t1"))).toBe(rgb("#c2410c"));
    expect(fill(bar(host, "t2"))).toBe(rgb("#fde047"));
    const label = (id) => group(host, id).querySelector(".sg-bar-label");
    expect(label("t1").classList.contains("sg-inside")).toBe(true);
    expect(fill(label("t1"))).toBe(rgb("#ffffff"));
    expect(fill(label("t2"))).toBe(rgb("#111111"));
    gantt.setCategories({ roofing: "#fef08a" });
    expect(fill(bar(host, "t1"))).toBe(rgb("#fef08a"));
    expect(fill(label("t1"))).toBe(rgb(token(gantt, "--sg-text-on-light")));
  });

  test("categoryOf colours by any field, e.g. trade", () => {
    const { host } = mount(data(), {
      showCriticalPath: false,
      categoryOf: (task) => task.trade,
      categories: { roofing: "#15803d" },
    });
    const roofing = data().tasks.find((task) => task.trade === "Roofing");
    expect(fill(bar(host, roofing.id))).toBe(rgb("#15803d"));
  });

  test("style.color colours one task; progress darkens it; text is chosen for contrast", () => {
    const programme = data();
    const task = programme.tasks.find((item) => item.id === "t2");
    task.style = { color: "#fde047" };
    task.progress = 0.5;
    const { host } = mount(programme, { showCriticalPath: false, barLabels: "inside" });
    expect(fill(bar(host, "t2"))).toBe(rgb("#fde047"));
    const progress = group(host, "t2").querySelector(".sg-progress");
    expect(progress.classList.contains("sg-custom-color")).toBe(true);
    expect(fill(progress)).not.toBe(rgb("#fde047"));
    expect(group(host, "t2").style.getPropertyValue("--sg-task-text")).toBe(
      "var(--sg-text-on-light)",
    );
  });

  test("milestones and payment milestones take custom colours too", () => {
    const programme = data();
    programme.tasks.find((task) => task.id === "p1").style = { color: "#0891b2" };
    const { host } = mount(programme, { showCriticalPath: false });
    expect(fill(host.querySelector('[data-task-id="p1"] .sg-milestone'))).toBe(rgb("#0891b2"));
  });

  test("taskClass and taskStyle callbacks add classes and styles", () => {
    const { host } = mount(data(), {
      showCriticalPath: false,
      taskClass: (task) => (task.id === "t1" ? "is-urgent" : null),
      taskStyle: (task) =>
        task.id === "t1" ? { "--sg-task-color": "#9333ea", opacity: "0.5" } : null,
    });
    expect(group(host, "t1").classList.contains("is-urgent")).toBe(true);
    expect(group(host, "t1").style.opacity).toBe("0.5");
    expect(fill(bar(host, "t1"))).toBe(rgb("#9333ea"));
    expect(group(host, "t2").classList.contains("is-urgent")).toBe(false);
  });

  test("the critical path is drawn over custom colours while it is shown", () => {
    const programme = data();
    programme.tasks.find((task) => task.id === "t3").style = { color: "#15803d" };
    const { gantt, host } = mount(programme, { criticalThreshold: 1000 });
    expect(gantt.getTask("t3").critical).toBe(true);
    expect(fill(bar(host, "t3"))).toBe(rgb(token(gantt, "--sg-bar-critical")));
    gantt.setCriticalPathVisible(false);
    expect(fill(bar(host, "t3"))).toBe(rgb("#15803d"));
  });

  test("links take a colour from style or category, with a matching arrowhead", () => {
    const programme = data();
    programme.links[0].style = { color: "#db2777" };
    programme.links[1].category = "roofing";
    const { host } = mount(programme, {
      showCriticalPath: false,
      categories: { roofing: "#0369a1" },
    });
    const line = (id) => host.querySelector(`[data-link-id="${id}"] .sg-link-line`);
    expect(getComputedStyle(line(programme.links[0].id)).stroke).toBe(rgb("#db2777"));
    expect(getComputedStyle(line(programme.links[1].id)).stroke).toBe(rgb("#0369a1"));
    const markerId = line(programme.links[0].id).getAttribute("marker-end").slice(5, -1);
    expect(fill(host.querySelector(`#${markerId} path`))).toBe(rgb("#db2777"));
    const plain = line(programme.links[2].id).getAttribute("marker-end");
    expect(plain).not.toBe(line(programme.links[0].id).getAttribute("marker-end"));
  });
});

describe("colour schemes", () => {
  const darkBg = () => rgb("#111827");

  test("colorScheme: dark uses the dark palette; light forces light", () => {
    const { gantt } = mount(data(), { colorScheme: "dark" });
    expect(gantt.root.classList.contains("sg-scheme-dark")).toBe(true);
    expect(getComputedStyle(gantt.root).backgroundColor).toBe(darkBg());
    expect(getComputedStyle(gantt.root).colorScheme).toBe("dark");
    const light = mount(data(), { colorScheme: "light" }).gantt;
    expect(getComputedStyle(light.root).backgroundColor).toBe(rgb("#ffffff"));
  });

  test("an ancestor with data-theme=dark switches the chart to dark", () => {
    const wrapper = document.createElement("div");
    wrapper.dataset.theme = "dark";
    wrapper.dataset.themeTest = "";
    document.body.append(wrapper);
    const { gantt } = mount(data());
    wrapper.append(gantt.host);
    expect(getComputedStyle(gantt.root).backgroundColor).toBe(darkBg());
  });

  test("DaisyUI variables on an ancestor win over the palette", () => {
    hostCSS(
      ".daisy-host { --color-base-100: rgb(10, 20, 30); --color-primary: rgb(200, 100, 0); }",
    );
    const { gantt, host } = mount(data(), { showCriticalPath: false });
    host.classList.add("daisy-host");
    expect(getComputedStyle(gantt.root).backgroundColor).toBe("rgb(10, 20, 30)");
    expect(fill(bar(host, "t1"))).toBe("rgb(200, 100, 0)");
  });

  test("the color-scheme attribute on the element maps to the option", async () => {
    const element = document.createElement("streamlined-gantt");
    element.setAttribute("color-scheme", "dark");
    element.dataset.themeTest = "";
    element.innerHTML = `<script type="application/json">${JSON.stringify(data())}</script>`;
    const { defineElement } = await import("../../src/element.js");
    defineElement();
    document.body.append(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.querySelector(".sg-root").classList.contains("sg-scheme-dark")).toBe(true);
  });
});

describe("print and export use the theme", () => {
  test("category and custom colours are resolved to literal fills in the SVG", () => {
    const programme = data();
    programme.tasks.find((task) => task.id === "t2").category = "roofing";
    programme.links[0].style = { color: "#db2777" };
    const { gantt } = mount(programme, {
      showCriticalPath: false,
      categories: { roofing: "#c2410c" },
    });
    const svg = buildDocument(gantt);
    const styled = [...svg.querySelectorAll(".sg-bar[style]")].map((element) =>
      element.getAttribute("style"),
    );
    expect(styled).toContain(`fill:${rgb("#c2410c")}`);
    expect(svg.querySelector(".sg-link-line[style]").getAttribute("style")).toBe(
      `stroke:${rgb("#db2777")}`,
    );
    const css = svg.querySelector("style").textContent;
    expect(css).not.toMatch(/var\(--/);
  });

  test("a dark chart exports a dark document", () => {
    const { gantt } = mount(data(), { colorScheme: "dark" });
    const css = buildDocument(gantt).querySelector("style").textContent;
    expect(css).toContain(`.bg{fill:${rgb("#111827")}}`);
  });
});
