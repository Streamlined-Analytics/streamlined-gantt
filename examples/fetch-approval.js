// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Gantt } from "/dist/streamlined-gantt.js";

/**
 * Server approval: `before-task-update` holds each edit until the backend
 * answers. 204 approves, 409 vetoes, and a JSON changeset replaces the local
 * result (here, a Friday start moved to Monday with its successors).
 */

const JOB = "/api/jobs/fetch-demo";
const status = document.getElementById("save-status");
const data = await (await fetch(`${JOB}/programme`)).json();
const gantt = new Gantt(document.getElementById("programme"), { data, height: "440px" });
window.gantt = gantt;

/**
 * @param {Response} response
 * @returns {Promise<object|false|undefined>}
 */
async function verdictFrom(response) {
  if (response.status === 204) return undefined;
  if (response.status === 409) {
    status.textContent = (await response.json()).message;
    status.dataset.outcome = "rejected";
    return false;
  }
  if (!response.ok) throw new Error(`Server error ${response.status}`);
  const changeset = await response.json();
  status.textContent = changeset.message;
  status.dataset.outcome = "corrected";
  return changeset;
}

/** @param {any} event */
function askServer(event) {
  const request = fetch(`${JOB}/tasks/${encodeURIComponent(event.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: event.new }),
  });
  event.waitUntil(request.then(verdictFrom));
}

/** @param {any} event */
function onSaved(event) {
  if (event.source === "server") return;
  status.textContent = "Saved";
  status.dataset.outcome = "saved";
}

gantt.on("before-task-update", askServer);
gantt.on("change", onSaved);
document.body.dataset.ready = "true";
