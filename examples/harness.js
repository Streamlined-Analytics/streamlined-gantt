// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Query-driven page for end-to-end and visual tests, e.g.
 * /examples/harness.html?fixture=/tests/fixtures/programmes/cpm-n1.json&zoom=day&today=2026-11-09
 * Every emitted event is recorded in window.events.
 */
import { Gantt, EVENT_NAME_LIST } from "/dist/streamlined-gantt.js";
import { builtinEditor } from "/dist/editor.js";
import { FLAT_ROOF_FIELDS } from "/examples/fields.js";
import { generatePerfProgramme } from "/tests/fixtures/perf/generate-perf-fixture.js";

const params = new URLSearchParams(location.search);
const fixture = params.get("fixture") ?? "/examples/data/flat-roof.json";
const data = fixture === "perf" ? generatePerfProgramme() : await (await fetch(fixture)).json();
const today = params.get("today") ?? "2026-11-09";
window.events = [];

const started = performance.now();
const gantt = new Gantt(document.getElementById("programme"), {
  editor: builtinEditor,
  data,
  fields: params.has("fields") ? FLAT_ROOF_FIELDS : [],
  zoom: params.get("zoom") ?? "week",
  readOnly: params.has("readOnly"),
  editMode: params.get("editMode") ?? "optimistic",
  autoSchedule: params.get("autoSchedule") ?? "propagate",
  showBaseline: params.get("baseline"),
  height: params.get("height") ?? "520px",
  columns: params.get("columns")?.split(","),
  today: () => today,
  on: Object.fromEntries(
    EVENT_NAME_LIST.map((name) => [name, (event) => window.events.push(event)]),
  ),
});
window.firstRenderMs = performance.now() - started;
window.gantt = gantt;
document.body.dataset.ready = "true";
