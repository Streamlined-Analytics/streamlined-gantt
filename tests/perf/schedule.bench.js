// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Engine micro-benchmarks (tinybench), run nightly: `node tests/perf/schedule.bench.js`.
 * Prints a table; fails when the median full schedule() of the 1,000-task
 * fixture exceeds 60 ms (twice the 30 ms budget).
 */
import { Bench } from "tinybench";
import { Calendar, analyse, schedule } from "../../src/engine/index.js";
import { generatePerfProgramme } from "../fixtures/perf/generate-perf-fixture.js";

const programme = generatePerfProgramme();
const calendar = new Calendar(programme.calendars?.[0] ?? { id: "default" });
const input = { tasks: programme.tasks, links: programme.links, calendar, mode: "propagate" };

const bench = new Bench({ time: 2000, warmupTime: 500 });
bench
  .add("schedule() 1,000 tasks / 1,500 links", () => schedule(input))
  .add("analyse() 1,000 tasks", () => analyse(programme))
  .add("Calendar.addWorkingDays x 10,000", () => {
    for (let index = 0; index < 10_000; index += 1) calendar.addWorkingDays(20_000 + index, 15);
  });
await bench.run();
console.table(bench.table());
const median = bench.tasks[0].result?.latency?.p50 ?? bench.tasks[0].result?.median ?? Infinity;
if (!(median < 60)) {
  console.error(`schedule() median ${median} ms exceeds the 60 ms budget`);
  process.exit(1);
}
