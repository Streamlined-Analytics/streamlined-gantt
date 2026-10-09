# 0003. Inclusive finish dates, day-number arithmetic and working-index scheduling

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** scheduling-engine
- **Builds on:** none — first ADR for scheduling-engine
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

Date handling causes more Gantt-library bugs than anything else. Frappe Gantt (#73, #81), vis-timeline
(#663, #1902) and jsGantt-improved all have trackers full of these:

- a resize that ends one day later than drawn (an exclusive end leaking into an inclusive UI)
- date-only strings shown a day early west of UTC
- daylight-saving changes dropping or doubling a day
- floats counted in calendar days instead of working days

We needed date semantics that UK site teams recognise, match MS Project and Asta, and cannot drift
by time zone. They also have to be fixed before v0.1, because changing them later breaks every
integrator's data.

## What did we try?

### Attempt 1 — exclusive finish dates in the public format ❌ rejected up front

This is the convention most libraries use internally (DHTMLX, Bryntum's engine). But MS Project,
Asta and every printed UK programme show the last working day. An exclusive `finish` in the JSON
would force every backend and every CSV reader to subtract a day, and that is the Frappe #73
bug.

### Attempt 2 — `Date` objects with local midnight ❌ rejected up front

`new Date("2026-11-02")` parses as UTC midnight and displays as 1 November in New York. Local
`Date` arithmetic gains or loses an hour across 29 March and 25 October. Neither is acceptable
for a date-only domain.

### Attempt 3 — integer day numbers, inclusive public finish, working-index CPM ✅ chosen

## What did we land on, and why?

- **Public format.** ISO `YYYY-MM-DD` calendar dates, with no time and no zone. A task's
  `finish` is **inclusive**: it is the last working day. `duration` counts working days. For a
  task starting on a working day, `finish = addWorkingDays(start, duration - 1)` and
  `duration = workingDaysBetween(start, finish)`.
- **Internal representation.** Integer day numbers (days since 1970-01-01), converted with
  Howard Hinnant's civil-calendar algorithms. The engine never constructs a `Date` for
  arithmetic. A test spies on the `Date` constructor and its local-time methods to prove it, and
  the engine suite runs in six time zones in CI. Display formatting uses `Intl.DateTimeFormat`
  pinned to UTC, fed `Date.UTC(...)` numbers.
- **Working index.** Each calendar maps a day to its _working index_ (the number of working
  days before it), using lazily built per-year cumulative tables. The CPM forward and backward
  passes run in index space with half-open intervals `[ES, EF)`, so every link rule is integer
  arithmetic:
  - FS: `ES_s ≥ EF_p + lag`
  - SS: `ES_s ≥ ES_p + lag`
  - FF: `EF_s ≥ EF_p + lag`
  - SF: `EF_s ≥ ES_p + lag`

  Dates are converted back only at the end, which is why floats are always in working days.

- **Duration is the planning quantity.** When a task stores both `finish` and `duration`,
  `duration` wins and the finish is derived from it. A calendar change, such as a new weather
  day, therefore moves the finish rather than silently shortening the task, as in MS Project. A
  task stored with only `finish` derives its duration from the calendar.
- **Started tasks are the exception.** For a task in progress, `duration` is its work in working
  days and the stored `finish` is the forecast: remaining work, `duration × (1 − progress)`, is
  rescheduled from the data date. Because the work quantity never changes, rescheduling reaches
  a fixed point instead of growing the task on every run. MS Project gets the same effect by
  splitting the task; there are no splits here, so the bar spans the gap.
- **`addWorkingDays(date, 0)` returns the input unchanged,** even on a non-working day. Snapping
  is explicit through `nextWorkingDay` and `previousWorkingDay`. For n > 0 from a non-working day,
  the first working day after it counts as the first.
- **Milestones** have `duration: 0` and `start === finish`. A milestone is a point:
  - It is _finish-anchored_ (at the end of its date) when any incoming link is FS or FF. That is
    how MS Project shows a payment milestone after a task, and its FS successor starts the next
    working day.
  - Otherwise it is _start-anchored_, like "start on site": its FS successor starts the same
    day.
- **Free float** is the smallest slack to any successor's early dates, with the project early
  finish treated as an implicit successor of every task. It is therefore never negative from
  logic alone and never exceeds total float on logic-driven networks. A contract completion date
  lowers total float, which can go negative, but not free float.
- **Calendars with no working time** throw `CalendarHasNoWorkingTimeError` after a bounded search
  (ten consecutive empty years). They do not loop forever.
- **Fixed-date tasks.** Locked tasks, reference tasks, need-by dates and complete tasks keep
  their stored dates. When logic would move one of them, a violation is reported instead.
- **Version 1 schedules every task on the programme's default calendar.** Per-task calendars are
  on the v2 roadmap.

These rules are pinned by known-answer fixtures: N1, N1 with a deadline, N1 across Christmas,
N2 with mixed links, and the England and Wales 2026–2027 calendar table. They are also pinned by
fast-check properties, compared against independent day-walking and CPM oracles in
`tests/support/`.

## What does this cost us?

- Hours and half-days are out of scope. Adding them later means a second index unit, and any
  time-of-day would need a new ADR.
- Importers from datetime-based formats (MSPDI) must normalise finishes, for example
  `17:00` on the finish date, or `08:00` or `00:00` on the next day, to the inclusive working day.
- Milestone anchoring depends on incoming link types. Changing an SS link into a milestone to FS
  can move the milestone's displayed date by one day. This is documented in the data-format
  guide.
