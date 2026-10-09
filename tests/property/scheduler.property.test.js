// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { Calendar, schedule, toDay } from "../../src/engine/index.js";
import { arbCalendarAround, arbDag, RUNS } from "../support/arbitraries.js";
import { oracleCpm } from "../support/oracle-cpm.js";
import { lazy } from "../support/lazy.js";

const START = "2026-11-02";
const monFri = lazy(() => new Calendar({ id: "mf" }));
const options = { numRuns: Math.max(100, Math.floor(RUNS / 4)) };

function toTasks(durations, start = START) {
  return Object.entries(durations).map(([id, duration]) => ({ id, name: id, start, duration }));
}

function run({ durations, links }, extra = {}) {
  return schedule({
    tasks: toTasks(durations),
    links,
    calendar: monFri,
    mode: "propagate",
    ...extra,
  });
}

const base = () => monFri.indexOf(toDay(START));
const startIndex = (iso) => monFri.indexOf(toDay(iso)) - base();
const finishIndex = (iso) => monFri.indexOf(toDay(iso) + 1) - base();

const forwardOnlyDag = arbDag({ minLag: 0 }).map(({ durations, links }) => ({
  durations: Object.fromEntries(
    Object.entries(durations).map(([id, duration]) => [id, Math.max(1, duration)]),
  ),
  links: links.map((link) => ({
    ...link,
    type: link.type === "FF" ? "FS" : link.type === "SF" ? "SS" : link.type,
  })),
}));

const barDag = arbDag().map(({ durations, links }) => ({
  durations: Object.fromEntries(
    Object.entries(durations).map(([id, duration]) => [id, Math.max(1, duration)]),
  ),
  links,
}));

describe("scheduler against the naive CPM oracle", () => {
  test.prop([barDag], options)("early and late dates and floats match", (network) => {
    const result = run(network);
    const oracle = oracleCpm(network.durations, network.links);
    for (const [id, expected] of Object.entries(oracle.tasks)) {
      const actual = result.tasks.get(id);
      expect({
        ES: startIndex(actual.earlyStart),
        EF: finishIndex(actual.earlyFinish),
        LS: startIndex(actual.lateStart),
        LF: finishIndex(actual.lateFinish),
        TF: actual.totalFloat,
        FF: actual.freeFloat,
      }).toEqual(expected);
    }
  });

  test.prop([barDag, fc.integer({ min: 1, max: 10 })], options)(
    "a contract completion k working days early lowers every total float by k",
    (network, k) => {
      const plain = run(network);
      const finish = toDay(plain.projectFinish);
      const completion = monFri.addWorkingDays(finish, -k);
      const late = run(network, { contractCompletion: monFri.convert("x", completion) });
      for (const [id, task] of plain.tasks) {
        expect(late.tasks.get(id).totalFloat).toBe(task.totalFloat - k);
      }
      expect(late.terminalFloat).toBe(-k);
    },
  );
});

describe("scheduler invariants", () => {
  test.prop([forwardOnlyDag], options)(
    "with logic-driven early starts, total float is at least free float, which is non-negative",
    (network) => {
      for (const task of run(network).tasks.values()) {
        expect(task.totalFloat).toBeGreaterThanOrEqual(task.freeFloat);
        expect(task.freeFloat).toBeGreaterThanOrEqual(0);
      }
    },
  );

  test.prop([barDag], options)(
    "early dates satisfy every link and floats are consistent",
    (network) => {
      const result = run(network);
      for (const task of result.tasks.values()) {
        expect(startIndex(task.earlyStart) <= startIndex(task.lateStart)).toBe(true);
        expect(task.totalFloat).toBeGreaterThanOrEqual(0);
        expect(task.start >= START).toBe(true);
      }
      expect(result.critical.length).toBeGreaterThan(0);
      for (const link of network.links) {
        const from = result.tasks.get(link.from);
        const to = result.tasks.get(link.to);
        const lag = link.lag ?? 0;
        const required = {
          FS: [startIndex(to.start), finishIndex(from.finish) + lag],
          SS: [startIndex(to.start), startIndex(from.start) + lag],
          FF: [finishIndex(to.finish), finishIndex(from.finish) + lag],
          SF: [finishIndex(to.finish), startIndex(from.start) + lag],
        }[link.type];
        expect(required[0]).toBeGreaterThanOrEqual(required[1]);
      }
    },
  );

  test.prop([arbDag()], options)(
    "milestones stay zero-duration points and late dates never precede early dates",
    (network) => {
      const result = run(network);
      for (const [id, task] of result.tasks) {
        if (network.durations[id] === 0) {
          expect(task.duration).toBe(0);
          expect(task.start).toBe(task.finish);
        }
        expect(task.lateStart >= task.earlyStart).toBe(true);
      }
    },
  );

  test.prop([arbDag(), fc.integer({ min: 0, max: 1_000 })], options)(
    "task and link input order does not matter",
    (network, seed) => {
      const shuffle = (items) =>
        fc.sample(fc.shuffledSubarray(items, { minLength: items.length }), { seed, numRuns: 1 })[0];
      const first = run(network);
      const second = schedule({
        tasks: shuffle(toTasks(network.durations)),
        links: shuffle(network.links),
        calendar: monFri,
        mode: "propagate",
      });
      expect(Object.fromEntries(second.tasks)).toEqual(Object.fromEntries(first.tasks));
    },
  );

  test.prop([arbDag()], options)("scheduling is idempotent", (network) => {
    const first = run(network);
    const tasks = toTasks(network.durations).map((task) => ({
      ...task,
      ...first.changed.find((change) => change.id === task.id),
    }));
    const second = schedule({ tasks, links: network.links, calendar: monFri, mode: "propagate" });
    expect(second.changed).toEqual([]);
    expect(Object.fromEntries(second.tasks)).toEqual(Object.fromEntries(first.tasks));
  });

  test.prop(
    [
      barDag,
      fc.nat(),
      fc.nat(),
      fc.constantFrom("FS", "SS", "FF", "SF"),
      fc.integer({ min: -3, max: 5 }),
    ],
    options,
  )(
    "adding a link never makes the project finish earlier",
    (network, fromSeed, toSeed, type, lag) => {
      const ids = Object.keys(network.durations);
      const [from, to] = [ids[fromSeed % ids.length], ids[toSeed % ids.length]];
      fc.pre(from !== to);
      const before = run(network);
      const candidate = {
        ...network,
        links: [...network.links, { id: "extra", from, to, type, lag }],
      };
      let after;
      try {
        after = run(candidate);
      } catch {
        return;
      }
      expect(after.projectFinish >= before.projectFinish).toBe(true);
    },
  );

  test.prop([barDag, fc.nat(), fc.integer({ min: 1, max: 10 })], options)(
    "propagate never pulls a task back after another task moves later",
    (network, pick, shift) => {
      const first = run(network);
      const settled = toTasks(network.durations).map((task) => ({
        ...task,
        ...first.changed.find((change) => change.id === task.id),
      }));
      const moved = settled[pick % settled.length];
      moved.start = monFri.convert("x", monFri.addWorkingDays(toDay(moved.start), shift));
      delete moved.finish;
      const second = schedule({
        tasks: settled,
        links: network.links,
        calendar: monFri,
        mode: "propagate",
        pinned: [moved.id],
      });
      for (const [id, task] of second.tasks) {
        expect(task.start >= first.tasks.get(id).start).toBe(true);
      }
    },
  );

  test.prop([arbCalendarAround(), arbDag({ maxTasks: 15 })], { numRuns: RUNS })(
    "scheduled tasks never start or finish on non-working days",
    ({ centre, calendar }, network) => {
      const engine = new Calendar(calendar);
      fc.pre(calendar.workWeek.length > 0);
      const tasks = toTasks(network.durations, centre);
      const result = schedule({ tasks, links: network.links, calendar: engine, mode: "propagate" });
      for (const task of result.tasks.values()) {
        if (task.duration === 0 && task.start === centre) continue;
        expect(engine.isWorking(task.start)).toBe(true);
        expect(engine.isWorking(task.finish)).toBe(true);
      }
    },
  );
});
