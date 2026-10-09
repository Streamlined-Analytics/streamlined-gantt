// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Gantt } from "/dist/streamlined-gantt.js";

/**
 * A host-owned editor: the chart calls `editor(task, {gantt})`; this page fills
 * its own <dialog> and saves through `gantt.updateTask()`, which validates,
 * reschedules successors, emits events and records undo.
 */

const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("task-dialog"));
const form = /** @type {HTMLFormElement} */ (document.getElementById("task-form"));
const error = document.getElementById("task-error");
/** @type {string|null} */
let editingId = null;

/** @param {Readonly<Record<string, any>>} task */
function openEditor(task) {
  editingId = task.id;
  form.elements.namedItem("name").value = task.name;
  form.elements.namedItem("start").value = task.start;
  form.elements.namedItem("duration").value = String(task.duration);
  form.elements.namedItem("trade").value = task.trade ?? "";
  error.textContent = "";
  dialog.showModal();
}

/** @param {SubmitEvent} event */
async function onSubmit(event) {
  if (event.submitter?.value !== "save" || !editingId) return;
  event.preventDefault();
  const values = new FormData(form);
  const patch = {
    name: String(values.get("name")),
    start: String(values.get("start")),
    duration: Number(values.get("duration")),
  };
  const trade = String(values.get("trade") ?? "").trim();
  if (trade) patch.trade = trade;
  const result = await gantt.updateTask(editingId, patch);
  if (!result.committed) {
    error.textContent = gantt.lastRejection?.message ?? "The change was not saved";
    return;
  }
  dialog.close("save");
}

const data = await (await fetch("/examples/data/flat-roof.json")).json();
const gantt = new Gantt(document.getElementById("programme"), {
  data,
  height: "440px",
  editor: openEditor,
});
window.gantt = gantt;
form.addEventListener("submit", onSubmit);
document.body.dataset.ready = "true";
