// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Shared JSDoc type definitions for the programme data format
 * (`"schema": "streamlined-gantt/1"`). See `schema/programme.v1.json`.
 *
 * Dates are ISO `YYYY-MM-DD` calendar dates with no time or zone. A task's
 * `finish` is **inclusive**: it is the last working day of the task.
 * `duration` and `lag` count working days. Money is integer minor units.
 *
 * @module engine/types
 */

/**
 * @typedef {"task"|"summary"|"milestone"|"payment"|"access"|"need-by"|"reference"} TaskType
 */

/**
 * @typedef {"FS"|"SS"|"FF"|"SF"} LinkType
 */

/**
 * @typedef {object} Constraint
 * @property {"ASAP"|"SNET"|"FNLT"} type
 * @property {string} [date] required for SNET and FNLT
 */

/**
 * @typedef {object} Task
 * @property {string} id
 * @property {string} name
 * @property {TaskType} [type]
 * @property {string|null} [parent]
 * @property {string} [wbs]
 * @property {string} [start] first working day
 * @property {string} [finish] last working day (inclusive)
 * @property {number} [duration] working days; 0 for milestones
 * @property {string} [calendar]
 * @property {number} [progress] 0..1
 * @property {string|null} [actualStart]
 * @property {string|null} [actualFinish]
 * @property {Constraint} [constraint]
 * @property {number} [value] integer minor units (payment milestones)
 * @property {number} [valuePercent] 0..1
 * @property {string} [trade]
 * @property {string} [crew]
 * @property {string} [owner]
 * @property {boolean} [locked]
 * @property {string} [notes]
 * @property {{name?: string, issued?: string}} [source] origin of a reference task
 * @property {{color?: string}} [style]
 * @property {string} [className]
 * @property {boolean} [collapsed]
 * @property {Record<string, unknown>} [fields] custom field values
 */

/**
 * @typedef {object} Link
 * @property {string} id
 * @property {string} from predecessor task id
 * @property {string} to successor task id
 * @property {LinkType} [type] default "FS"
 * @property {number} [lag] working days; negative is a lead
 */

/**
 * @typedef {object} Baseline
 * @property {string} id
 * @property {string} [name]
 * @property {string} [captured]
 * @property {Record<string, {start: string, finish: string}>} tasks
 */

/**
 * @typedef {object} DelayEvent
 * @property {string} id
 * @property {"weather"|"access"|"information"|"variation"|"client"|"other"} [kind]
 * @property {string} from
 * @property {string} to
 * @property {string[]} [taskIds]
 * @property {string} [title]
 * @property {string} [description]
 * @property {{type?: string, url: string, caption?: string}[]} [evidence]
 * @property {string} [status]
 * @property {Record<string, unknown>} [fields]
 */

/**
 * @typedef {object} Marker
 * @property {string} id
 * @property {string} date
 * @property {string} [label]
 * @property {string} [kind]
 */

/**
 * @typedef {object} Revision
 * @property {string} code
 * @property {string} [date]
 * @property {string} [author]
 * @property {string} [note]
 */

/**
 * @typedef {object} Programme
 * @property {"streamlined-gantt/1"} [schema]
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [currency]
 * @property {string} [dataDate]
 * @property {string} [contractCompletion]
 * @property {Revision} [revision]
 * @property {Revision[]} [revisions]
 * @property {string} [defaultCalendar]
 * @property {import("./calendar.js").CalendarDefinition[]} [calendars]
 * @property {Task[]} tasks
 * @property {Link[]} [links]
 * @property {Baseline[]} [baselines]
 * @property {DelayEvent[]} [delayEvents]
 * @property {Marker[]} [markers]
 * @property {Record<string, unknown>} [fields]
 */

/**
 * A changeset: the format accepted by `applyPatch()` and returned by
 * `getChanges()`, and the format a backend may resolve from `waitUntil()`.
 * `update` entries carry the id plus only the properties that change.
 *
 * @typedef {object} CollectionPatch
 * @property {object[]} [add]
 * @property {object[]} [update]
 * @property {string[]} [remove]
 */

/**
 * @typedef {object} Changeset
 * @property {CollectionPatch} [tasks]
 * @property {CollectionPatch} [links]
 * @property {CollectionPatch} [delayEvents]
 * @property {CollectionPatch} [markers]
 * @property {CollectionPatch} [baselines]
 * @property {Record<string, unknown>} [project] top-level properties to set
 */

export {};
