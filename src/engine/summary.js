// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { addDays, addMonths, startOfMonth, startOfWeek, toDay, toISO } from "./dates.js";
import { leafTasks, weightedProgress } from "./analysis.js";
import { isNumericField } from "./fields.js";

/**
 * Project-level aggregates for host pages: duration, field sums and derived
 * values, the stage-payment schedule and time-phased series for charts.
 * Plain data, no DOM. Money stays in integer minor units throughout; values
 * spread over working days are split with the remainder given to the earliest
 * days, so bucket totals always sum exactly to the field total.
 *
 * @module engine/summary
 */

/**
 * @typedef {object} PaymentEntry
 * @property {string} taskId
 * @property {string} name
 * @property {string} date
 * @property {number} value minor units
 * @property {number} cumulative minor units
 * @property {number} percentOfTotal value / total of all payments
 * @property {number} cumulativePercent cumulative / total of all payments
 */

/**
 * @typedef {object} SummaryOptions
 * @property {string[]} [fields] numeric fields to sum and spread (default: every numeric field with a roll-up)
 * @property {(task: import("./types.js").Task) => boolean} [filter]
 * @property {"week"|"month"|null} [bucket]
 * @property {"linear"|"start"|"finish"} [spread]
 * @property {import("./types.js").Baseline|null} [baseline]
 */

/**
 * @typedef {object} ProjectSummary
 * @property {string|null} start
 * @property {string|null} finish
 * @property {number} workingDays
 * @property {number} calendarDays
 * @property {string|null} plannedCompletion
 * @property {string|null} contractCompletion
 * @property {number|null} terminalFloat
 * @property {number} taskCount
 * @property {number} criticalCount
 * @property {number} progress duration-weighted, 0..1
 * @property {Record<string, number>} sums
 * @property {Record<string, unknown>} derived roll-ups of computed fields
 * @property {{id: string, name?: string, finish: string|null, varianceWorkingDays: number|null}|null} baseline
 * @property {PaymentEntry[]} payments
 * @property {Record<string, (number|string)[]>} [series]
 */

/**
 * Splits an integer amount over `count` slots without losing a penny.
 * @param {number} amount
 * @param {number} count
 * @returns {number[]}
 */
export function splitEvenly(amount, count) {
  if (count <= 0) return [];
  const sign = amount < 0 ? -1 : 1;
  const magnitude = Math.abs(amount);
  const base = Math.floor(magnitude / count);
  const remainder = magnitude - base * count;
  return Array.from({ length: count }, (_, index) => sign * (base + (index < remainder ? 1 : 0)));
}

/**
 * @param {import("./analysis.js").Analysis} analysis
 * @param {string[]} fieldKeys
 * @returns {string[]}
 */
function defaultFieldKeys(analysis, fieldKeys) {
  if (fieldKeys) return fieldKeys;
  return analysis.fields
    .list()
    .filter((definition) => isNumericField(definition) && definition.rollup && !definition.compute)
    .map((definition) => definition.key);
}

/**
 * @param {import("./analysis.js").Analysis} analysis
 * @param {import("./types.js").Task[]} leaves
 * @param {import("./types.js").Programme} programme
 * @returns {PaymentEntry[]}
 */
export function paymentSchedule(analysis, leaves, programme) {
  const payments = leaves
    .filter((task) => task.type === "payment")
    .map((task, order) => ({ task, order, day: analysis.resolved.get(task.id).start }))
    .sort((first, second) => first.day - second.day || first.order - second.order);
  const total = payments.reduce((sum, entry) => sum + (entry.task.value ?? 0), 0);
  let cumulative = 0;
  void programme;
  return payments.map(({ task, day }) => {
    const value = task.value ?? 0;
    cumulative += value;
    return {
      taskId: task.id,
      name: task.name,
      date: toISO(day),
      value,
      cumulative,
      percentOfTotal: total ? value / total : 0,
      cumulativePercent: total ? cumulative / total : 0,
    };
  });
}

/**
 * @param {import("./analysis.js").Analysis} analysis
 * @param {import("./types.js").Baseline|null|undefined} baseline
 * @param {number} finishDay
 * @returns {ProjectSummary["baseline"]}
 */
function baselineSummary(analysis, baseline, finishDay) {
  if (!baseline) return null;
  const finishes = Object.values(baseline.tasks ?? {}).map((dates) => toDay(dates.finish));
  if (!finishes.length)
    return { id: baseline.id, name: baseline.name, finish: null, varianceWorkingDays: null };
  const baselineFinish = Math.max(...finishes);
  const variance = Number.isFinite(finishDay)
    ? analysis.calendar.indexOf(finishDay + 1) - analysis.calendar.indexOf(baselineFinish + 1)
    : null;
  return {
    id: baseline.id,
    name: baseline.name,
    finish: toISO(baselineFinish),
    varianceWorkingDays: variance,
  };
}

/**
 * @param {number} first
 * @param {number} last
 * @param {"week"|"month"} bucket
 * @returns {number[]} bucket start days
 */
function bucketStarts(first, last, bucket) {
  const starts = [];
  let current = bucket === "week" ? startOfWeek(first) : startOfMonth(first);
  while (current <= last) {
    starts.push(current);
    current = bucket === "week" ? addDays(current, 7) : addMonths(current, 1);
  }
  return starts;
}

/**
 * @param {number[]} starts
 * @param {number} day
 * @returns {number}
 */
function bucketIndex(starts, day) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= day) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * @param {number[]} values
 * @returns {number[]}
 */
function cumulativeOf(values) {
  let running = 0;
  return values.map((value) => (running += value));
}

/**
 * Working days of a task (milestones count as their single date).
 * @param {import("./analysis.js").Analysis} analysis
 * @param {import("./analysis.js").ResolvedTask} dates
 * @returns {number[]}
 */
function workingDaysOf(analysis, dates) {
  if (dates.milestone) return [dates.start];
  const days = [];
  for (let day = dates.start; day <= dates.finish; day += 1) {
    if (analysis.calendar.isWorkingDayNumber(day)) days.push(day);
  }
  return days.length ? days : [dates.start];
}

/**
 * @param {import("./analysis.js").Analysis} analysis
 * @param {import("./types.js").Task[]} leaves
 * @param {{bucket: "week"|"month", spread: string, fieldKeys: string[], payments: PaymentEntry[], first: number, last: number}} options
 * @returns {Record<string, (number|string)[]>}
 */
function buildSeries(analysis, leaves, options) {
  const starts = bucketStarts(options.first, options.last, options.bucket);
  /** @type {Record<string, number[]>} */
  const perField = Object.fromEntries(options.fieldKeys.map((key) => [key, starts.map(() => 0)]));
  for (const task of leaves) {
    const values = analysis.fieldValues.get(task.id) ?? {};
    const days = workingDaysOf(analysis, analysis.resolved.get(task.id));
    const chosenDays =
      options.spread === "start"
        ? [days[0]]
        : options.spread === "finish"
          ? [days[days.length - 1]]
          : days;
    for (const key of options.fieldKeys) {
      const value = values[key];
      if (typeof value !== "number" || value === 0) continue;
      const shares = Number.isInteger(value)
        ? splitEvenly(value, chosenDays.length)
        : chosenDays.map(() => value / chosenDays.length);
      chosenDays.forEach((day, index) => {
        perField[key][bucketIndex(starts, day)] += shares[index];
      });
    }
  }
  const payments = starts.map(() => 0);
  for (const payment of options.payments)
    payments[bucketIndex(starts, toDay(payment.date))] += payment.value;
  /** @type {Record<string, (number|string)[]>} */
  const series = {
    buckets: starts.map(toISO),
    payments,
    paymentsCumulative: cumulativeOf(payments),
  };
  for (const key of options.fieldKeys) {
    series[key] = perField[key];
    series[`${key}Cumulative`] = cumulativeOf(perField[key]);
  }
  return series;
}

/**
 * @param {import("./analysis.js").Analysis} analysis
 * @param {import("./types.js").Programme} programme
 * @param {SummaryOptions} [options]
 * @returns {ProjectSummary}
 */
export function projectSummary(analysis, programme, options = {}) {
  const filter = options.filter ?? (() => true);
  const leaves = leafTasks(analysis).filter((task) => filter(task));
  const fieldKeys = defaultFieldKeys(analysis, options.fields);
  let first = Infinity;
  let last = -Infinity;
  for (const task of leaves) {
    const dates = analysis.resolved.get(task.id);
    first = Math.min(first, dates.start);
    last = Math.max(last, dates.finish);
  }
  const hasDates = Number.isFinite(first);
  const rows = leaves.map((task) => ({
    task,
    values: analysis.fieldValues.get(task.id) ?? {},
    duration: analysis.resolved.get(task.id).duration,
  }));
  const allSums = analysis.fields.sums(rows.map((row) => row.values));
  const sums = Object.fromEntries(fieldKeys.map((key) => [key, allSums[key] ?? 0]));
  /** @type {Record<string, unknown>} */
  const derived = {};
  for (const definition of analysis.fields.computed()) {
    derived[definition.key] = analysis.fields.rollup(definition, rows, allSums);
  }
  const contractCompletion = programme.contractCompletion ?? null;
  const terminalFloat =
    contractCompletion && hasDates
      ? analysis.calendar.indexOf(toDay(contractCompletion) + 1) -
        analysis.calendar.indexOf(last + 1)
      : null;
  const critical = new Set(analysis.schedule.critical);
  const payments = paymentSchedule(analysis, leaves, programme);
  /** @type {ProjectSummary} */
  const summary = {
    start: hasDates ? toISO(first) : null,
    finish: hasDates ? toISO(last) : null,
    workingDays: hasDates ? analysis.calendar.workingDaysBetween(first, last) : 0,
    calendarDays: hasDates ? last - first + 1 : 0,
    plannedCompletion: hasDates ? toISO(last) : null,
    contractCompletion,
    terminalFloat,
    taskCount: leaves.length,
    criticalCount: leaves.filter((task) => critical.has(task.id)).length,
    progress: weightedProgress(leaves, analysis.resolved),
    sums,
    derived,
    baseline: baselineSummary(analysis, options.baseline, last),
    payments,
  };
  if (options.bucket && hasDates) {
    summary.series = buildSeries(analysis, leaves, {
      bucket: options.bucket,
      spread: options.spread ?? "linear",
      fieldKeys,
      payments,
      first,
      last,
    });
  }
  return summary;
}
