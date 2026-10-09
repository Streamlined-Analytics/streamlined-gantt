// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { EVENT_CATALOGUE } from "../../src/events.js";
import { defineElement } from "../../src/element.js";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";
import { cleanup, frame, mount, pointerDrag } from "./support.js";

afterEach(cleanup);
defineElement();

const click = (element, type = "click", init = {}) =>
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));

/**
 * One action per catalogue event that makes the library emit it.
 * @type {Record<string, (context: {gantt: any, host: HTMLElement}) => unknown>}
 */
const TRIGGERS = {
  "task-click": ({ host }) => click(host.querySelector('[data-task-id="t5"] .sg-hit')),
  "task-dblclick": ({ host }) =>
    click(host.querySelector('[data-task-id="t5"] .sg-hit'), "dblclick"),
  "task-contextmenu": ({ host }) =>
    click(host.querySelector('[data-task-id="t5"] .sg-hit'), "contextmenu"),
  "milestone-click": ({ host }) => click(host.querySelector('[data-task-id="p2"] .sg-hit')),
  "link-click": ({ host }) => click(host.querySelector('[data-link-id="l5"] .sg-link-hit')),
  "link-dblclick": ({ host }) =>
    click(host.querySelector('[data-link-id="l5"] .sg-link-hit'), "dblclick"),
  "row-click": ({ host }) =>
    click(host.querySelector('.sg-grid-body [data-task-id="t3"] [role=gridcell]')),
  "cell-click": ({ host }) => {
    const svg = host.querySelector(".sg-svg");
    const box = svg.getBoundingClientRect();
    click(svg, "click", { clientX: box.left + 5, clientY: box.top + 5 });
  },
  "delay-click": ({ host }) => click(host.querySelector('[data-delay-id="d1"]')),
  "task-hover-start": ({ host }) =>
    host
      .querySelector('[data-task-id="t5"] .sg-hit')
      .dispatchEvent(new PointerEvent("pointerover", { bubbles: true })),
  "task-hover-end": ({ host }) => {
    const bar = host.querySelector('[data-task-id="t5"] .sg-hit');
    bar.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    bar.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        relatedTarget: host.querySelector(".sg-svg"),
      }),
    );
  },
  "selection-change": ({ gantt }) => gantt.select(["t3"]),
  "drag-start": ({ host }) =>
    pointerDrag(host.querySelector('[data-task-id="t5"] .sg-hit'), { dx: 40 }),
  "drag-move": ({ host }) =>
    pointerDrag(host.querySelector('[data-task-id="t5"] .sg-hit'), { dx: 40 }),
  "drag-end": ({ host }) =>
    pointerDrag(host.querySelector('[data-task-id="t5"] .sg-hit'), { dx: 40 }),
  "before-task-add": ({ gantt }) => gantt.addTask({ id: "n", name: "New" }),
  "task-add": ({ gantt }) => gantt.addTask({ id: "n", name: "New" }),
  "before-task-update": ({ gantt }) => gantt.updateTask("t5", { name: "Renamed" }),
  "task-update": ({ gantt }) => gantt.updateTask("t5", { name: "Renamed" }),
  "before-task-remove": ({ gantt }) => gantt.removeTask("t8"),
  "task-remove": ({ gantt }) => gantt.removeTask("t8"),
  "before-link-add": ({ gantt }) => gantt.addLink({ id: "x", from: "t1", to: "t3" }),
  "link-add": ({ gantt }) => gantt.addLink({ id: "x", from: "t1", to: "t3" }),
  "before-link-update": ({ gantt }) => gantt.updateLink("l5", { lag: 1 }),
  "link-update": ({ gantt }) => gantt.updateLink("l5", { lag: 1 }),
  "before-link-remove": ({ gantt }) => gantt.removeLink("l5"),
  "link-remove": ({ gantt }) => gantt.removeLink("l5"),
  "before-delay-add": ({ gantt }) =>
    gantt.addDelayEvent({ id: "d2", kind: "access", from: "2026-11-10", to: "2026-11-10" }),
  "delay-add": ({ gantt }) =>
    gantt.addDelayEvent({ id: "d2", kind: "access", from: "2026-11-10", to: "2026-11-10" }),
  "before-delay-update": ({ gantt }) => gantt.updateDelayEvent("d1", { title: "Gale" }),
  "delay-update": ({ gantt }) => gantt.updateDelayEvent("d1", { title: "Gale" }),
  "before-delay-remove": ({ gantt }) => gantt.removeDelayEvent("d1"),
  "delay-remove": ({ gantt }) => gantt.removeDelayEvent("d1"),
  "before-editor-open": ({ gantt }) => gantt.openEditor("t5"),
  "project-update": ({ gantt }) => gantt.setProject({ revision: { code: "C" } }),
  "field-change": ({ gantt }) => gantt.updateTask("t5", { fields: { cost: 1 } }),
  "validation-error": ({ gantt }) => gantt.updateTask("t5", { fields: { cost: -1 } }),
  change: ({ gantt }) => gantt.updateTask("t5", { name: "Renamed" }),
  "edit-rejected": ({ gantt }) => gantt.updateTask("a1", { start: "2026-11-03" }),
  "zoom-change": ({ gantt }) => gantt.setZoom("day"),
  scroll: async ({ gantt }) => {
    gantt.scroller.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 150));
  },
  "expand-change": ({ gantt }) => gantt.collapse("s2"),
  "lookahead-change": ({ gantt }) => gantt.setLookahead({ weeks: 2 }),
  "filter-change": ({ gantt }) => gantt.setFilter(() => true),
  "readonly-change": ({ gantt }) => gantt.setReadOnly(true),
  "baseline-visibility-change": ({ gantt }) => gantt.setBaselineVisible("bl1"),
  "critical-path-visibility-change": ({ gantt }) => gantt.setCriticalPathVisible(false),
  load: ({ gantt }) => gantt.load(structuredClone(flatRoof)),
  render: ({ gantt }) => gantt.render(),
  schedule: ({ gantt }) => gantt.updateTask("t5", { duration: 7 }),
  error: async ({ host }) => {
    const element = document.createElement("streamlined-gantt");
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = JSON.stringify(flatRoof);
    element.append(script);
    host.append(element);
    await frame();
    element.setAttribute("src", "/does-not-exist.json");
    await new Promise((resolve) => setTimeout(resolve, 300));
  },
  destroy: ({ gantt }) => gantt.destroy(),
};

describe("event catalogue", () => {
  test("every catalogue event has a trigger in this suite", () => {
    const missing = EVENT_CATALOGUE.map((spec) => spec.name).filter((name) => !TRIGGERS[name]);
    expect(missing).toEqual([]);
  });

  test.each(EVENT_CATALOGUE.map((spec) => [spec.name, spec]))(
    "%s reaches on() handlers and the DOM mirror with the same object",
    async (name, spec) => {
      const { gantt, host } = mount(structuredClone(flatRoof), { fields: FLAT_ROOF_FIELDS });
      const fromEmitter = [];
      const fromDom = [];
      gantt.on(name, (event) => fromEmitter.push(event));
      const listener = (event) => fromDom.push(event);
      document.addEventListener(`gantt:${name}`, listener);
      try {
        await TRIGGERS[name]({ gantt, host });
        await frame();
      } finally {
        document.removeEventListener(`gantt:${name}`, listener);
      }
      const domEvents = fromDom.filter((event) => event.type === `gantt:${name}`);
      expect(domEvents.length).toBeGreaterThan(0);
      if (name !== "error") {
        expect(fromEmitter.length).toBeGreaterThan(0);
        expect(domEvents[0].detail).toBe(fromEmitter[0]);
      }
      expect(domEvents[0].bubbles).toBe(true);
      expect(domEvents[0].cancelable).toBe(name.startsWith("before-"));
      const detail = domEvents[0].detail;
      expect(detail.type ?? name).toBe(name);
      for (const key of spec.payload.filter(
        (field) => !["error", "originalEvent"].includes(field),
      )) {
        if (name === "error") continue;
        expect(key in detail, `${name} payload has ${key}`).toBe(true);
      }
    },
  );
});
