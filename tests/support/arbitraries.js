// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { fc } from "@fast-check/vitest";
import { toDayNumber, toIsoString } from "./oracle-calendar.js";

/** Runs per property: 1,000 on PRs, 10,000 nightly (SG_FC_RUNS). */
export const RUNS = Number(process.env.SG_FC_RUNS ?? 1_000);

/** @param {{min?: string, max?: string}} [range] */
export function arbIsoDate({ min = "1999-01-01", max = "2101-12-31" } = {}) {
  return fc.integer({ min: toDayNumber(min), max: toDayNumber(max) }).map(toIsoString);
}

/**
 * A random calendar centred on a random date, with holidays, shutdown ranges
 * and working exceptions near the centre so they actually matter.
 */
export function arbCalendarAround() {
  return fc
    .record({
      centre: fc.integer({ min: toDayNumber("1999-06-01"), max: toDayNumber("2101-06-01") }),
      workWeek: fc.subarray([1, 2, 3, 4, 5, 6, 7], { minLength: 1 }),
      holidays: fc.array(fc.integer({ min: -400, max: 400 }), { maxLength: 40 }),
      shutdowns: fc.array(
        fc.tuple(fc.integer({ min: -400, max: 400 }), fc.integer({ min: 0, max: 14 })),
        { maxLength: 3 },
      ),
      workingDays: fc.array(fc.integer({ min: -400, max: 400 }), { maxLength: 5 }),
    })
    .map(({ centre, workWeek, holidays, shutdowns, workingDays }) => ({
      centre: toIsoString(centre),
      calendar: {
        id: "random",
        workWeek,
        nonWorking: [
          ...holidays.map((offset) => ({ date: toIsoString(centre + offset) })),
          ...shutdowns.map(([offset, length]) => ({
            from: toIsoString(centre + offset),
            to: toIsoString(centre + offset + length),
          })),
        ],
        working: workingDays.map((offset) => ({ date: toIsoString(centre + offset) })),
      },
    }));
}

const LINK_TYPES = ["FS", "SS", "FF", "SF"];

/**
 * A random DAG: edges only go from a lower to a higher index, then ids are shuffled.
 * @param {{maxTasks?: number, minLag?: number, maxLag?: number}} [options]
 */
export function arbDag({ maxTasks = 40, minLag = -5, maxLag = 10 } = {}) {
  return fc
    .integer({ min: 1, max: maxTasks })
    .chain((count) =>
      fc.record({
        durations: fc.array(fc.integer({ min: 0, max: 15 }), {
          minLength: count,
          maxLength: count,
        }),
        edges:
          count < 2
            ? fc.constant([])
            : fc.uniqueArray(
                fc
                  .tuple(fc.integer({ min: 0, max: count - 2 }), fc.nat())
                  .map(([from, offset]) => [from, from + 1 + (offset % (count - 1 - from))]),
                { maxLength: count * 2, selector: ([from, to]) => `${from}-${to}` },
              ),
        types: fc.array(fc.constantFrom(...LINK_TYPES), {
          minLength: count * 2,
          maxLength: count * 2,
        }),
        lags: fc.array(fc.integer({ min: minLag, max: maxLag }), {
          minLength: count * 2,
          maxLength: count * 2,
        }),
        names: fc.shuffledSubarray(
          Array.from({ length: count }, (_, index) => `t${index}`),
          { minLength: count, maxLength: count },
        ),
      }),
    )
    .map(({ durations, edges, types, lags, names }) => ({
      durations: Object.fromEntries(durations.map((duration, index) => [names[index], duration])),
      links: edges.map(([from, to], index) => ({
        id: `l${index}`,
        from: names[from],
        to: names[to],
        type: types[index],
        lag: lags[index],
      })),
    }));
}
