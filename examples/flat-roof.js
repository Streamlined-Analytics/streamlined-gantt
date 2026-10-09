// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Gantt } from "/dist/streamlined-gantt.js";
import { builtinEditor } from "/dist/editor.js";
import { FLAT_ROOF_FIELDS } from "/examples/fields.js";

const response = await fetch("/examples/data/flat-roof.json");
const data = await response.json();
const log = document.getElementById("log");

function record(text) {
  const item = document.createElement("li");
  item.textContent = text;
  log.prepend(item);
  while (log.children.length > 12) log.lastElementChild.remove();
}

const gantt = new Gantt(document.getElementById("programme"), {
  editor: builtinEditor,
  data,
  fields: FLAT_ROOF_FIELDS,
  zoom: "week",
  showBaseline: "bl1",
  height: "460px",
  today: () => "2026-11-09",
  on: {
    change: (event) =>
      record(
        `change (${event.cause}): ${event.changes.tasks.updated.map((entry) => entry.id).join(", ") || "no task dates"}`,
      ),
  },
});

gantt.on("edit-rejected", (event) => record(`rejected: ${event.reason}`));
for (const button of document.querySelectorAll("[data-zoom]")) {
  button.addEventListener("click", () => gantt.setZoom(button.dataset.zoom));
}
document.getElementById("undo").addEventListener("click", () => gantt.undo());
document.getElementById("redo").addEventListener("click", () => gantt.redo());
window.gantt = gantt;
