// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { snapshot } from "../setup/instrument-globals.js";
import htmx from "htmx.org/dist/htmx.esm.js";
import { expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { defineElement } from "../../src/element.js";
import { Gantt } from "../../src/index.js";

defineElement();

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 3; index += 1)
    await new Promise((resolve) => requestAnimationFrame(resolve));
};

const markup = `<streamlined-gantt height="300px" listen-patch><script type="application/json">${JSON.stringify(flatRoof)}</script></streamlined-gantt>`;

async function swapCycle(host) {
  const loaded = new Promise((resolve) =>
    host.addEventListener("gantt:load", resolve, { once: true }),
  );
  htmx.swap(host, markup, { swapStyle: "innerHTML" });
  await loaded;
  const element = host.querySelector("streamlined-gantt");
  element.gantt.updateTask("t5", { start: "2026-11-16" }, { cause: "drag" });
  element.gantt.scroller.dispatchEvent(new Event("scroll"));
  await settle();
  htmx.swap(host, "<p>swapped out</p>", { swapStyle: "innerHTML" });
  await settle();
}

test("50 htmx swap cycles leave no listeners, observers, timers or frames behind", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  await swapCycle(host);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await settle();
  const before = snapshot();
  for (let cycle = 0; cycle < 50; cycle += 1) await swapCycle(host);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await settle();
  const after = snapshot();
  expect(after).toEqual(before);
  host.remove();
});

test("destroy is idempotent and releases everything, even mid-drag with an approval pending", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  await settle();
  const before = snapshot();
  const gantt = new Gantt(host, { data: structuredClone(flatRoof), height: "300px" });
  gantt.on("before-task-update", (event) => event.waitUntil(new Promise(() => {})));
  const pending = gantt.updateTask("t5", { start: "2026-11-16" });
  const bar = host.querySelector('[data-task-id="t3"] .sg-hit');
  const box = bar.getBoundingClientRect();
  bar.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 9,
      pointerType: "mouse",
      button: 0,
      clientX: box.left + 5,
      clientY: box.top + 5,
    }),
  );
  host.querySelector(".sg-svg").dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 9,
      pointerType: "mouse",
      clientX: box.left + 40,
      clientY: box.top + 5,
    }),
  );
  await settle();
  const events = [];
  gantt.on("change", () => events.push("change"));
  gantt.destroy();
  gantt.destroy();
  expect(await pending).toMatchObject({ committed: false, reason: "destroyed" });
  await settle();
  expect(snapshot()).toEqual(before);
  expect(events).toEqual([]);
  expect(host.children).toHaveLength(0);
  host.remove();
});

test("re-creating a chart on the same host after destroy works", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const first = new Gantt(host, { data: structuredClone(flatRoof) });
  first.destroy();
  const second = new Gantt(host, { data: structuredClone(flatRoof) });
  expect(host.querySelectorAll(".sg-root")).toHaveLength(1);
  await second.updateTask("t5", { name: "Works" });
  expect(second.getTask("t5").name).toBe("Works");
  second.destroy();
  host.remove();
});
