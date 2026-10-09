// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { Calendar } from "../../src/engine/calendar.js";
import { arbCalendarAround, RUNS } from "../support/arbitraries.js";
import { makeOracle, toDayNumber, toIsoString } from "../support/oracle-calendar.js";

const scenario = arbCalendarAround().chain(({ centre, calendar }) =>
  fc.record({
    calendar: fc.constant(calendar),
    date: fc
      .integer({ min: -420, max: 420 })
      .map((offset) => toIsoString(toDayNumber(centre) + offset)),
  }),
);
const count = fc.integer({ min: -60, max: 60 });
const options = { numRuns: RUNS };

describe("calendar engine against the day-walking oracle", () => {
  test.prop([scenario, count], options)(
    "addWorkingDays matches the oracle",
    ({ calendar, date }, n) => {
      expect(new Calendar(calendar).addWorkingDays(date, n)).toBe(
        makeOracle(calendar).addWorkingDays(date, n),
      );
    },
  );

  test.prop([scenario, fc.integer({ min: 0, max: 120 })], options)(
    "workingDaysBetween matches the oracle",
    ({ calendar, date }, span) => {
      const finish = toIsoString(toDayNumber(date) + span);
      expect(new Calendar(calendar).workingDaysBetween(date, finish)).toBe(
        makeOracle(calendar).workingDaysBetween(date, finish),
      );
    },
  );

  test.prop([scenario], options)(
    "isWorking and nextWorkingDay match the oracle",
    ({ calendar, date }) => {
      const engine = new Calendar(calendar);
      const oracle = makeOracle(calendar);
      expect(engine.isWorking(date)).toBe(oracle.isWorking(date));
      expect(engine.nextWorkingDay(date)).toBe(oracle.nextWorkingDay(date));
    },
  );
});

describe("calendar algebra", () => {
  const workingScenario = scenario.map(({ calendar, date }) => {
    const engine = new Calendar(calendar);
    return { engine, date: engine.nextWorkingDay(date) };
  });

  test.prop([scenario, count.filter((n) => n !== 0)], options)(
    "results land on working days",
    ({ calendar, date }, n) => {
      const engine = new Calendar(calendar);
      expect(engine.isWorking(engine.addWorkingDays(date, n))).toBe(true);
    },
  );

  test.prop([workingScenario, count], options)(
    "adding then subtracting returns to a working start",
    ({ engine, date }, n) => {
      expect(engine.addWorkingDays(engine.addWorkingDays(date, n), -n)).toBe(date);
    },
  );

  test.prop([workingScenario, fc.nat(40), fc.nat(40)], options)(
    "addition is associative from a working day",
    ({ engine, date }, a, b) => {
      expect(engine.addWorkingDays(engine.addWorkingDays(date, a), b)).toBe(
        engine.addWorkingDays(date, a + b),
      );
    },
  );

  test.prop([scenario, count, count], options)(
    "addition is monotonic in n",
    ({ calendar, date }, first, second) => {
      fc.pre(first !== second);
      const engine = new Calendar(calendar);
      const [low, high] = first < second ? [first, second] : [second, first];
      expect(engine.addWorkingDays(date, low) < engine.addWorkingDays(date, high)).toBe(true);
    },
  );

  test.prop([workingScenario, fc.nat(60)], options)(
    "inclusive finish identity: between(d, add(d, n)) = n + 1",
    ({ engine, date }, n) => {
      expect(engine.workingDaysBetween(date, engine.addWorkingDays(date, n))).toBe(n + 1);
    },
  );
});
