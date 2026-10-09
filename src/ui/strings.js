// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Every user-visible string, in British English. Override any of them with
 * the `strings` option.
 *
 * @module ui/strings
 */
export const DEFAULT_STRINGS = {
  gridLabel: "Programme tasks",
  timelineLabel: "Programme timeline",
  columnWbs: "WBS",
  columnName: "Task",
  columnStart: "Start",
  columnFinish: "Finish",
  columnDuration: "Days",
  columnProgress: "Progress",
  columnFloat: "Float",
  columnVariance: "Var.",
  columnValue: "Value",
  columnTrade: "Trade",
  columnCrew: "Crew",
  weekCommencing: "w/c",
  quarterPrefix: "Q",
  expand: "Expand",
  collapse: "Collapse",
  today: "Today",
  dataDate: "Data date",
  contractCompletion: "Completion date",
  milestone: "Milestone",
  payment: "Stage payment",
  access: "Access date",
  needBy: "Needed by",
  reference: "Main contractor",
  summary: "Summary",
  critical: "Critical",
  locked: "Locked",
  workingDays: "working days",
  workingDay: "working day",
  movedTo: "{name} moved to {date}",
  finishNow: "finish now {date}",
  resizedTo: "{name} now {duration} {days}, finishing {date}",
  successorsRescheduled: "{count} other tasks rescheduled",
  successorRescheduled: "1 other task rescheduled",
  progressSet: "{name} {percent} complete",
  linkCreated: "Linked {from} to {to} ({type})",
  linkRemoved: "Link removed",
  undone: "Undone: {label}",
  redone: "Redone: {label}",
  nothingToUndo: "Nothing to undo",
  nothingToRedo: "Nothing to redo",
  rejected: "Change not saved: {message}",
  pending: "Saving…",
  readOnlyRefused: "This programme is read-only",
  lockedRefused: "{name} is locked",
  dragHint: "Drag to move. Alt and arrow keys move the focused task by one working day.",
  taskRow: "{name}, {start} to {finish}, {duration} {days}",
  milestoneRow: "{name}, {type} on {date}",
};

/**
 * Fills `{placeholders}` from values.
 * @param {string} template
 * @param {Record<string, string|number>} [values]
 * @returns {string}
 */
export function fill(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}
