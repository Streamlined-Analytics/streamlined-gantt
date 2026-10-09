// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { readFileSync } from "node:fs";
import { Calendar, schedule } from "../../src/engine/index.js";

/** @param {string} relativePath path under tests/fixtures */
export function loadFixture(relativePath) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${relativePath}`, import.meta.url), "utf8"));
}

export const ewCalendar = () => loadFixture("calendars/england-wales-2026-2027.json").calendar;

export const N1_DURATIONS = { A: 3, B: 4, C: 2, D: 5, E: 3, F: 4, G: 2, H: 6, I: 3, J: 2 };
export const N1_LINKS = [
  ["A", "B"],
  ["A", "C"],
  ["B", "D"],
  ["C", "E"],
  ["C", "F"],
  ["D", "G"],
  ["E", "G"],
  ["F", "H"],
  ["G", "I"],
  ["H", "I"],
  ["I", "J"],
].map(([from, to], index) => ({ id: `l${index + 1}`, from, to, type: "FS", lag: 0 }));

export const N2_DURATIONS = { A: 4, B: 3, C: 5, D: 2, E: 3, F: 1 };
export const N2_LINKS = [
  { id: "l1", from: "A", to: "B", type: "FS", lag: 0 },
  { id: "l2", from: "A", to: "C", type: "SS", lag: 2 },
  { id: "l3", from: "B", to: "D", type: "FF", lag: 1 },
  { id: "l4", from: "C", to: "E", type: "FS", lag: -1 },
  { id: "l5", from: "D", to: "F", type: "FS", lag: 0 },
  { id: "l6", from: "E", to: "F", type: "FS", lag: 0 },
  { id: "l7", from: "A", to: "E", type: "SF", lag: 3 },
];

/**
 * A programme whose tasks all start on `start` with the given durations, so
 * the scheduler places them by logic alone.
 */
export function networkProgramme({ start, durations, links, calendar = ewCalendar(), ...rest }) {
  return {
    schema: "streamlined-gantt/1",
    defaultCalendar: calendar.id,
    calendars: [calendar],
    tasks: Object.entries(durations).map(([id, duration]) => ({
      id,
      name: `Task ${id}`,
      start,
      duration,
    })),
    links: links.map((link) => ({ ...link })),
    ...rest,
  };
}

/** Applies a propagate-mode schedule to a programme's stored dates (returns a copy). */
export function scheduledProgramme(programme) {
  const result = schedule({
    tasks: programme.tasks,
    links: programme.links ?? [],
    calendar: new Calendar(programme.calendars?.[0] ?? { id: "default" }),
    dataDate: programme.dataDate ?? null,
    contractCompletion: programme.contractCompletion ?? null,
    mode: "propagate",
  });
  const changes = new Map(result.changed.map((change) => [change.id, change]));
  return {
    ...programme,
    tasks: programme.tasks.map((task) => {
      const change = changes.get(task.id);
      if (!change) return task;
      const { id: _id, ...dates } = change;
      return { ...task, ...dates };
    }),
  };
}
