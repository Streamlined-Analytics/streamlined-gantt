// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { defineConfig, defineElement } from "../../src/element.js";
import { frame } from "./support.js";

defineElement();
defineElement();

const hosts = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function container() {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  return host;
}

const settle = async () => {
  for (let index = 0; index < 5; index += 1) await frame();
};

function inlineElement(attributes = "") {
  return `<streamlined-gantt ${attributes} height="300px"><script type="application/json">${JSON.stringify(flatRoof)}</script></streamlined-gantt>`;
}

describe("<streamlined-gantt>", () => {
  test("initialises once from an inline JSON script and exposes element.gantt", async () => {
    const host = container();
    const loads = [];
    host.addEventListener("gantt:load", (event) => loads.push(event));
    host.innerHTML = inlineElement('zoom="day"');
    await settle();
    const element = host.querySelector("streamlined-gantt");
    expect(element.gantt).not.toBeNull();
    expect(element.gantt.zoom).toBe("day");
    expect(loads).toHaveLength(1);
    expect(element.querySelector(".sg-root")).not.toBeNull();
  });

  test("loads from src and applies attributes and a named configuration", async () => {
    defineConfig("roof", {
      fields: [{ key: "cost", type: "currency", rollup: "sum", column: true }],
    });
    const host = container();
    host.innerHTML =
      '<streamlined-gantt src="/tests/fixtures/programmes/flat-roof.json" config="roof" read-only show-baseline="bl1"></streamlined-gantt>';
    const element = host.querySelector("streamlined-gantt");
    await new Promise((resolve) => element.addEventListener("gantt:load", resolve, { once: true }));
    expect(element.gantt.readOnly).toBe(true);
    expect(element.gantt.baselineId).toBe("bl1");
    expect(element.gantt.columns.map((column) => column.id)).toContain("fields.cost");
    element.setAttribute("zoom", "month");
    element.removeAttribute("read-only");
    element.setAttribute("critical-path", "false");
    element.setAttribute("show-baseline", "");
    expect(element.gantt.zoom).toBe("month");
    expect(element.gantt.readOnly).toBe(false);
    expect(element.gantt.showCriticalPath).toBe(false);
  });

  test("removal destroys the instance; moving it does not", async () => {
    const host = container();
    const other = container();
    host.innerHTML = inlineElement();
    await settle();
    const element = host.querySelector("streamlined-gantt");
    const instance = element.gantt;
    const destroyed = [];
    instance.on("destroy", () => destroyed.push(true));
    other.append(element);
    await settle();
    expect(element.gantt).toBe(instance);
    expect(destroyed).toHaveLength(0);
    element.remove();
    await settle();
    expect(destroyed).toHaveLength(1);
    expect(instance.destroyed).toBe(true);
    expect(element.gantt).toBeNull();
    instance.destroy();
  });

  test("a failed src fetch dispatches gantt:error", async () => {
    const host = container();
    const errors = [];
    host.addEventListener("gantt:error", (event) => errors.push(event.detail.message));
    host.innerHTML = '<streamlined-gantt src="/missing.json"></streamlined-gantt>';
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(errors[0]).toMatch(/HTTP 404/);
  });

  test("removal while the src fetch is in flight aborts it", async () => {
    const host = container();
    host.innerHTML =
      '<streamlined-gantt src="/tests/fixtures/programmes/flat-roof.json"></streamlined-gantt>';
    const element = host.querySelector("streamlined-gantt");
    element.remove();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(element.gantt).toBeNull();
  });

  test("listen-patch applies gantt:patch events, honouring the target id", async () => {
    const host = container();
    host.innerHTML = inlineElement('id="job" listen-patch');
    await settle();
    const element = host.querySelector("streamlined-gantt");
    document.body.dispatchEvent(
      new CustomEvent("gantt:patch", {
        bubbles: true,
        detail: { target: "other", tasks: { update: [{ id: "t5", name: "Ignored" }] } },
      }),
    );
    expect(element.gantt.getTask("t5").name).toBe("Insulation and membrane");
    document.body.dispatchEvent(
      new CustomEvent("gantt:patch", {
        bubbles: true,
        detail: { target: "job", tasks: { update: [{ id: "t5", name: "Patched by server" }] } },
      }),
    );
    expect(element.gantt.getTask("t5").name).toBe("Patched by server");
    element.dispatchEvent(
      new CustomEvent("gantt:patch", {
        bubbles: true,
        detail: {
          target: "#job",
          elt: element,
          changes: { tasks: { update: [{ id: "t5", name: "Selector target, as htmx sends it" }] } },
        },
      }),
    );
    expect(element.gantt.getTask("t5").name).toBe("Selector target, as htmx sends it");
  });

  test("the color-scheme attribute maps to the option", async () => {
    const host = container();
    host.innerHTML = inlineElement('color-scheme="dark"');
    await settle();
    const element = host.querySelector("streamlined-gantt");
    expect(element.querySelector(".sg-root").classList.contains("sg-scheme-dark")).toBe(true);
  });
});
