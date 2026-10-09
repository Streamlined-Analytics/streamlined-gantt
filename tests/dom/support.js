// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import "../../src/css/streamlined-gantt.css";
import { Gantt } from "../../src/index.js";

/** @type {Gantt[]} */
const mounted = [];

/**
 * Mounts a Gantt in a sized host element.
 * @param {object} data
 * @param {Record<string, unknown>} [options]
 * @returns {{gantt: Gantt, host: HTMLElement}}
 */
export function mount(data, options = {}) {
  const host = document.createElement("div");
  host.style.width = options.width ?? "1200px";
  document.body.append(host);
  const gantt = new Gantt(host, { data, height: "640px", today: () => "2026-11-09", ...options });
  mounted.push(gantt);
  return { gantt, host };
}

export function cleanup() {
  for (const gantt of mounted.splice(0)) {
    gantt.destroy();
    gantt.host.remove();
  }
}

/** Waits for the next animation frame. */
export function frame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

/**
 * Dispatches a synthetic pointer sequence on an element and returns once it
 * has been processed (one frame after the last move).
 * @param {Element} target
 * @param {{dx: number, dy?: number, pointerType?: string, steps?: number, release?: boolean}} options
 */
export async function pointerDrag(target, options) {
  const box = target.getBoundingClientRect();
  const startX = box.left + box.width / 2;
  const startY = box.top + box.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: options.pointerType ?? "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
  };
  target.dispatchEvent(
    new PointerEvent("pointerdown", { ...base, clientX: startX, clientY: startY }),
  );
  const steps = options.steps ?? 6;
  const svg = target.closest("svg");
  for (let step = 1; step <= steps; step += 1) {
    const clientX = startX + (options.dx * step) / steps;
    const clientY = startY + ((options.dy ?? 0) * step) / steps;
    svg.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX, clientY }));
    await frame();
  }
  if (options.release === false) return;
  svg.dispatchEvent(
    new PointerEvent("pointerup", {
      ...base,
      buttons: 0,
      clientX: startX + options.dx,
      clientY: startY + (options.dy ?? 0),
    }),
  );
  await frame();
}

export { Gantt };
