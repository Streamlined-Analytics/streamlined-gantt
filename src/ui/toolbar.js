// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { html } from "./dom.js";
import { fill } from "./strings.js";

/**
 * The optional built-in toolbar (`toolbar: true`): zoom, today, undo and redo,
 * baseline and critical-path toggles, lookahead and print. Host pages usually
 * render their own (DaisyUI) toolbar and call the API instead.
 *
 * @module ui/toolbar
 */

/**
 * @param {import("./gantt.js").Gantt} gantt
 * @returns {HTMLElement}
 */
export function buildToolbar(gantt) {
  const s = gantt.strings;
  const bar = html("div", { class: "sg-toolbar", role: "toolbar", "aria-label": s.toolbarLabel });
  const action = (label, handler, attributes = {}) => {
    const element = html("button", { type: "button", class: "sg-button", ...attributes }, [label]);
    element.addEventListener("click", handler);
    return element;
  };
  const zoom = /** @type {HTMLSelectElement} */ (
    html(
      "select",
      { "aria-label": "Zoom" },
      ["day", "week", "month", "quarter"].map((level) =>
        html("option", { value: level, selected: level === gantt.zoom }, [
          s[`zoom${level[0].toUpperCase()}${level.slice(1)}`],
        ]),
      ),
    )
  );
  zoom.addEventListener("change", () => gantt.setZoom(/** @type {any} */ (zoom.value)));
  gantt.on("zoom-change", (event) => {
    zoom.value = /** @type {any} */ (event).zoom;
  });
  const lookahead = /** @type {HTMLSelectElement} */ (
    html("select", { "aria-label": s.lookahead }, [
      html("option", { value: "" }, [s.lookaheadOff]),
      ...[2, 3, 4].map((weeks) =>
        html("option", { value: String(weeks) }, [fill(s.lookaheadWeeks, { weeks })]),
      ),
    ])
  );
  lookahead.addEventListener("change", () =>
    gantt.setLookahead(lookahead.value ? { weeks: Number(lookahead.value) } : null),
  );
  const toggle = (label, pressed, handler) => {
    const element = action(
      label,
      () => {
        const next = element.getAttribute("aria-pressed") !== "true";
        element.setAttribute("aria-pressed", String(next));
        handler(next);
      },
      { "aria-pressed": String(pressed) },
    );
    return element;
  };
  bar.append(
    zoom,
    action(s.today, () => gantt.scrollToDate(gantt.todayISO(), { align: "center" })),
    action(s.undo, () => gantt.undoWithAnnouncement()),
    action(s.redo, () => gantt.redoWithAnnouncement()),
    toggle(s.showBaseline, Boolean(gantt.baselineId), (on) =>
      gantt.setBaselineVisible(on ? "current" : null),
    ),
    toggle(s.showCritical, gantt.showCriticalPath, (on) => gantt.setCriticalPathVisible(on)),
    lookahead,
  );
  const printable = /** @type {any} */ (gantt);
  if (typeof printable.print === "function") bar.append(action(s.print, () => printable.print()));
  return bar;
}
