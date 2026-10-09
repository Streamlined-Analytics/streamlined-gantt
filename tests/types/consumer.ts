// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Compile-only checks of the published declarations, resolved through the
 * package's own `exports` (self-reference), as a TypeScript user would see them.
 * Run by `npm run test:types`; nothing here executes.
 */
import {
  Calendar,
  Gantt,
  GanttValidationError,
  schedule,
  type GanttOptions,
  type Programme,
} from "streamlined-gantt";
import { addWorkingDays, projectSummary } from "streamlined-gantt/engine";
import { buildToolbar } from "streamlined-gantt/toolbar";
import { check } from "streamlined-gantt/health";
import { exportCSV } from "streamlined-gantt/io/csv";
import { fromMSPDI, toMSPDI, MspdiParseError } from "streamlined-gantt/io/mspdi";
import { exportPNG, printProgramme } from "streamlined-gantt/print";
import { EVENT_NAMES } from "streamlined-gantt/events";

declare const host: HTMLElement;

const options: GanttOptions = {
  zoom: "week",
  colorScheme: "dark",
  theme: { bar: "#0f766e", barRadius: "0px", bogusNull: null },
  categories: { roofing: "#c2410c", scaffold: { color: "#334155", text: "#ffffff" } },
  categoryOf: (task) => task.trade,
  taskClass: (task) => (task.locked ? "locked" : null),
  taskStyle: () => ({ "--sg-task-color": "#9333ea" }),
  toolbar: buildToolbar,
  barLabels: "inside",
};
const gantt = new Gantt(host, options);
gantt.setTheme({ barCritical: "#be123c", rowAlt: null });
gantt.setCategories({ roofing: null });
gantt.on("change", (event) => event.type);

const csv: string = exportCSV(gantt);
const findings = check(gantt).map((finding) => finding.code);
const data: Programme = gantt.toJSON();
const xml: string = toMSPDI(data);
const imported = fromMSPDI(xml);
const warnings: string[] = imported.warnings;
const next: string = addWorkingDays("2026-11-02", 5, new Calendar({ id: "c" }));
const result = schedule({ tasks: [], links: [], calendar: new Calendar({ id: "c" }) });
const events = EVENT_NAMES;
const png: Promise<Blob> = exportPNG(gantt);
void [
  csv,
  findings,
  warnings,
  next,
  result.projectFinish,
  events,
  png,
  printProgramme,
  projectSummary,
];
void [GanttValidationError, MspdiParseError];

// @ts-expect-error colorScheme accepts only "auto", "light" or "dark"
new Gantt(host, { colorScheme: "sepia" });
// @ts-expect-error toolbar takes a factory, not an element
new Gantt(host, { toolbar: document.createElement("div") });
