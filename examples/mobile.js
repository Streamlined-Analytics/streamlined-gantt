// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * The phone experience with the script-tag build: the mobile add-on
 * (dist/mobile.iife.min.js) installs itself, so `mobile: {…}` is all it takes.
 */
const host = document.getElementById("programme");
const state = document.getElementById("mobile-state");
const data = await (await fetch("/examples/data/office-fit-out.json")).json();

host.addEventListener("gantt:layout-change", (event) => {
  state.textContent = `Showing the ${event.detail.mode} view (${event.detail.orientation}).`;
});
host.addEventListener("gantt:fullscreen-change", (event) => {
  if (event.detail.open) state.textContent = "The chart is open full screen.";
});

window.gantt = new window.StreamlinedGantt.Gantt(host, {
  data,
  layout: "timeline",
  fit: "width",
  colorScheme: "light",
  markers: { today: false, dataDate: false, contractCompletion: false },
  contextMenu: false,
  mobile: { breakpoint: 600 },
});
document.body.dataset.ready = "true";
