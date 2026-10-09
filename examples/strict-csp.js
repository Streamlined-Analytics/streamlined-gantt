// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Gantt } from "/dist/streamlined-gantt.js";

/** Records CSP violations so the page (and its test) can show there are none. */
const violations = [];
window.cspViolations = violations;

/** @param {SecurityPolicyViolationEvent} event */
function recordViolation(event) {
  violations.push(`${event.violatedDirective}: ${event.blockedURI || event.sample}`);
  const item = document.createElement("li");
  item.textContent = violations.at(-1);
  document.getElementById("violations").append(item);
}

document.addEventListener("securitypolicyviolation", recordViolation);
const data = await (await fetch("/examples/data/flat-roof.json")).json();
const gantt = new Gantt(document.getElementById("programme"), {
  data,
  height: "420px",
  categories: { roofing: "#c2410c" },
  categoryOf: (task) => task.trade,
  barLabels: "inside",
  theme: { barRadius: "0px" },
});
window.gantt = gantt;
document.body.dataset.ready = "true";
