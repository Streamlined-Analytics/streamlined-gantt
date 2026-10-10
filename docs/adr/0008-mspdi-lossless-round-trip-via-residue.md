# 0008. MSPDI import and export: native fields plus a residue patch

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** io/mspdi
- **Builds on:** ADR-0003 (inclusive finish dates and working-index scheduling)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

Teams receive and send programmes as MS Project files. The MVP has to read MS Project XML
(MSPDI) from MS Project, Asta Powerproject, P6 and MPXJ, and write files those tools open. The
round trip also has to be **lossless for supported fields**: exporting a programme and importing
it again must give back exactly what we started with. That includes things MSPDI has no field
for: payment and access task types, custom fields, link ids, delay events, markers, revisions,
and calendar exception kinds.

The spec also caps each IO module at 10 KB gzip, and the XML must be safe to parse in the
browser.

## What did we try?

### Attempt 1: hand-written inverse mapping per field ❌ rejected

The first draft computed a residue by predicting, field by field, what import would rebuild.
This duplicated the import logic in the exporter. Every import rule (summary detection, how
finish is normalised, milestones without a duration) had to be mirrored exactly, or the round
trip silently lost data. Calendars were stored whole whenever an id differed, so every bank
holiday was duplicated into the residue.

### Attempt 2: export, re-import natively, store the diff ✅ chosen

Export writes the native MSPDI fields, then parses its own output with the native-only importer,
then stores `diff(original, rebuilt)` as the residue. The residue is correct by construction,
because it is computed against the real importer.

The diff is a small structural patch (`io/residue.js`):

- replace a value;
- edit an object key by key;
- edit a same-length array element by element.

As a result, a calendar whose holidays lost their `kind` stores only the kinds. Keys are emitted
in sorted order, so exporting the imported data again produces byte-identical XML.

### Attempt 3: validate inside the IO module ❌ rejected for size

Bundling the schema validator took the module to 13.1 KB gzip, against the 10 KB budget.
Callers already validate whenever data is loaded into a `Gantt` or `ProgrammeController`, or
when they call `validateProgramme`. So the module converts formats and leaves validation to the
caller.

## What did we land on, and why?

**Where the residue lives.** Each task's residue goes in the Text4 extended attribute (alias
"streamlined-gantt data"). Text fields are limited to 255 characters, so longer residues move
to the project-level residue. The project-level residue goes in the notes of the project summary
task (UID 0), prefixed `streamlined-gantt:`. It carries:

- programme-level differences;
- the original task and link order;
- a flag for an absent `links` key;
- task residues that overflowed Text4.

Link residues ride on the successor task, matched by position.

**Fields by alias.** The id, trade and crew go in Text1–Text3. Import finds all four fields by
their alias, case-insensitively, in any Text slot. A foreign file's unrelated Text1 is therefore
never taken for an id. This was found on MPXJ's `task-text` sample.

**Native mapping.**

- Durations are working minutes divided by `MinutesPerDay`, which defaults to 480 and is read
  from the file.
- `LinkLag` is in tenths of a minute; elapsed lags are converted at 5/7 and percentage lags are
  dropped.
- Link types are FF 0, FS 1, SF 2, SS 3.
- Constraints are ASAP 0, SNET 4, FNLT 7. Other constraint types are dropped with a warning.
- `value` maps to `FixedCost`.
- Baselines 0–10 are read and written.

**Finish normalisation.** A finish at or before the start of the working day (midnight, or 08:00
the next day, as some tools write it) is the previous working day. This keeps ADR-0003's
inclusive finish. Stored task durations follow ADR-0003's "duration wins" rule. Finish is stored
only for in-progress tasks, where it is the forecast.

**Calendars.** Export writes plain ranges (`Type` 1). Import also expands the recurring kinds:

- every N days;
- weekly with a `DaysOfWeek` bitmap where Sunday is 1;
- monthly absolute and relative, including "last";
- yearly absolute and relative.

Project 2003 `DayType` 0 exceptions are read only when there is no `Exceptions` list. MS Project
writes both, and reading both doubled every exception. Resource calendars are skipped, and a
calendar with no week days keeps Monday to Friday.

**Safety.** The XML reader is our own (`io/xml.js`). It rejects any DOCTYPE, which closes off
external entities and entity-expansion attacks, and decodes only the five predefined entities
plus numeric references. It does not need `DOMParser`, so it runs in workers and Node too. Patch
application never assigns `__proto__`.

**Fixtures and the XSD.** The MSPDI XSD ships in the Project 2007 SDK under a EULA that does not
permit redistribution, and there is no stable public URL to fetch it from with a checksum. We
neither vendor nor fetch it. Element order follows the published schema, and a test pins the
Task element order. MPXJ's sample files are LGPL, so we do not commit them. The nightly workflow
fetches three of them at a pinned commit (`7ccc953…`), checks their SHA-256 and imports them
(`tests/io/mpxj.nightly.test.js`). The committed foreign-file fixture
(`tests/fixtures/mspdi/foreign-project.xml`) is hand-written in MS Project's shape.

## What does this cost us?

- A file edited in MS Project keeps native edits, unless the residue overrides the same field.
  For example, if the task type was `payment`, the residue restores `payment` even when the
  user removed the milestone flag. That is rare, and documented.
- Export runs the importer once, roughly doubling export time. That is still milliseconds for
  1,000 tasks.
- The residue is opaque JSON in a visible Text column. It has a clear alias, and users can hide
  the column.
- Resources, assignments, time of day and split tasks are not imported.
