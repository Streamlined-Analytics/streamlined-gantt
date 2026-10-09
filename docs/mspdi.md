# MS Project XML (MSPDI)

`streamlined-gantt/io/mspdi` reads and writes MS Project XML. MS Project, Asta Powerproject,
Primavera P6, ProjectLibre and MPXJ-based tools can all open and save this format. The module
is optional: it is not part of the core bundle. It is 9.9 KB gzip, has no dependencies, and runs
in the browser, in workers and in Node.

```js
import { toMSPDI, fromMSPDI, MspdiParseError } from "streamlined-gantt/io/mspdi";

const xml = toMSPDI(gantt.toJSON()); // a string, ready to save as programme.xml

const { programme, warnings } = fromMSPDI(await file.text());
gantt.load(programme); // validates; throws GanttValidationError with JSON Pointer paths
for (const warning of warnings) console.warn(warning);
```

For a page without a bundler, use `dist/io/mspdi.iife.min.js`, which defines
`StreamlinedGanttMSPDI`.

## Options

`toMSPDI(programme, options)` takes:

| Option          | Default      | Meaning                                     |
| --------------- | ------------ | ------------------------------------------- |
| `minutesPerDay` | `480`        | Working minutes per day (`MinutesPerDay`).  |
| `startTime`     | `"08:00:00"` | Start of the working day, written on dates. |
| `finishTime`    | `"17:00:00"` | End of the working day, written on dates.   |

`fromMSPDI(xml)` reads `MinutesPerDay` and `DefaultStartTime` from the file. It does not
validate the result, so the module stays small. Loading the result into a `Gantt` or
`ProgrammeController`, or calling `validateProgramme`, validates it.

## What maps to what

| streamlined-gantt                                      | MSPDI                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `name`, `currency`, `dataDate`                         | `Title`, `CurrencyCode`, `StatusDate`                                   |
| task `name`, `wbs`, `notes`                            | `Name`, `WBS`, `Notes`                                                  |
| `parent`                                               | `OutlineLevel` (the task tree), `OutlineNumber`                         |
| `start`, `duration`, finish                            | `Start` at 08:00, `Finish` at 17:00, `Duration` in working time         |
| milestones and points (`payment`, `access`, `need-by`) | `Milestone` = 1, duration 0                                             |
| summaries                                              | `Summary` = 1, dates rolled up from their tasks                         |
| `progress`, `actualStart`, `actualFinish`              | `PercentComplete`, `ActualStart`, `ActualFinish`                        |
| `constraint` ASAP / SNET / FNLT                        | `ConstraintType` 0 / 4 / 7 and `ConstraintDate`                         |
| `value` (minor units)                                  | `FixedCost`                                                             |
| task `calendar`                                        | `CalendarUID`                                                           |
| links FS / SS / FF / SF with `lag`                     | `PredecessorLink` `Type` 1 / 3 / 0 / 2, `LinkLag` in tenths of a minute |
| calendars                                              | base calendars: `WeekDays` and `Exceptions`                             |
| baselines 0–10                                         | task `Baseline` `Number`, `Start`, `Finish`                             |
| task `id`, `trade`, `crew`                             | Text1–Text3, aliased "streamlined-gantt id", "Trade", "Crew"            |

Import finds the id, trade and crew fields by their alias, case-insensitively and in any Text
slot. A Text column aliased "Trade" in a client's file therefore becomes `trade`. An unrelated
Text1 is never used as a task id; tasks without one get `t` followed by the UID.

## Round trip

Exporting and importing again gives back exactly the same programme data, and exporting that
again gives byte-identical XML. This covers everything MSPDI has no field for:

- task types (`payment`, `access`, `need-by`, `reference`);
- custom `fields`, `valuePercent`, `locked`, `style`, `owner`;
- link ids;
- delay events, markers, revisions, `contractCompletion` and programme `fields`;
- calendar ids and exception kinds;
- baseline names;
- the original task and link order;
- characters XML 1.0 cannot hold, in any text (names, ids, notes, trade, crew, custom fields,
  calendar names, the programme name). These are control characters other than tab, line feed
  and carriage return, lone surrogates, U+FFFE and U+FFFF. The native fields leave them out,
  so MS Project shows the text without them, and the residue restores them. A carriage return
  is written as `&#13;`, so XML parsers keep it rather than turning it into a line feed.

It works by storing a small _residue_: the difference between the original and what the native
fields rebuild. Each task's residue goes in the Text4 column (alias "streamlined-gantt data").
Programme-level data goes in the notes of the project summary task, starting
`streamlined-gantt:`. Text columns hold at most 255 characters, so a longer task residue moves
to the project notes. Hide the column in MS Project if you like, but do not delete it, or the
extra data is lost on the next import.

If someone edits the file in MS Project, their edits to native fields are kept. The exception
is a field the residue also holds, such as a `payment` type on a task whose milestone flag they
cleared: the residue restores the original value there.

## Import from other tools

- **Durations:** working minutes ÷ `MinutesPerDay`, rounded to whole days with a minimum of 1.
  Elapsed durations are read from the dates instead.
- **Finishes:** a finish at or before the start of the working day (midnight, or 08:00 as some
  tools write it) counts as the previous working day, so finishes stay inclusive. Finish is
  stored only for tasks in progress, where it is the forecast; otherwise duration wins.
- **Calendars:** exceptions are expanded into dates, including recurring ones (every N days;
  weekly; monthly on a date or "first/last Friday"; yearly). The older Project 2003 list is read
  only when the newer one is missing. Resource calendars are skipped. A calendar with no week
  days keeps Monday to Friday.
- **Warnings** (in `warnings`) report each of these:
  - an unsupported constraint (MSO, MFO, SNLT, FNET, ALAP) that was dropped;
  - a link to a missing or external task that was dropped;
  - an elapsed lag that was converted (5 working days per 7);
  - a percentage lag that was dropped;
  - a calendar exception with an unknown recurrence;
  - unreadable residue data, in which case the native fields are used.
- **Not imported:** resources, assignments, costs other than fixed cost, time of day, split
  tasks and leveling.

## Safety

The XML reader is written for this module. It rejects any `<!DOCTYPE>`, so external entities
(XXE) and entity-expansion ("billion laughs") attacks cannot happen. It decodes only the five
standard entities and numeric character references, and does not need `DOMParser`. Malformed
XML throws `MspdiParseError` with `line` and `column`. Export always writes a well-formed XML
1.0 document; a test checks it with libxml2. A document whose root is not `<Project>`
throws a `TypeError`.

See [ADR-0008](adr/0008-mspdi-lossless-round-trip-via-residue.md) for why it works this way.
