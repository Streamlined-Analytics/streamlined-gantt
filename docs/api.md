# API reference

The chart is a `Gantt` (`streamlined-gantt`). `Gantt` extends `ProgrammeController`, which holds
the data, transactions, events and undo, and also runs without the DOM. Data is described in
`schema/programme.v1.json`, events in [events.md](events.md), styling in
[theming.md](theming.md), and backend patterns in [integration.md](integration.md).

```js
import { Gantt } from "streamlined-gantt";
const gantt = new Gantt(hostElement, { data, zoom: "week" });
```

Or, with no JavaScript: `<streamlined-gantt src="/jobs/42/programme.json"></streamlined-gantt>`.
Its attributes are `src`, `zoom`, `read-only`, `critical-path`, `show-baseline`, `locale`,
`edit-mode`, `auto-schedule`, `height`, `color-scheme`, `layout`, `fit`, `toolbar`, `listen-patch`
and `config`
(the name of options registered with `defineConfig(name, options)`). The instance is
`element.gantt`.

## Options

### Data and behaviour (`ProgrammeController`)

| Option                       | Default                    | Meaning                                                                                     |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `data`                       | none                       | Programme data (validated; invalid data throws `GanttValidationError`)                      |
| `fields`                     | `[]`                       | Custom field definitions (cost, charge, quantity, computed margin, roll-ups)                |
| `autoSchedule`               | `"propagate"`              | `"propagate"` pushes successors later, `"tight"` also pulls them back, `"off"` only reports |
| `editMode`                   | `"optimistic"`             | With `waitUntil` approvals: show the edit while waiting, or `"confirm"` (wait first)        |
| `approvalTimeout`            | `15000`                    | Milliseconds before a pending approval is rejected                                          |
| `historyLimit`               | `100`                      | Undo steps kept                                                                             |
| `criticalThreshold`          | `0`                        | Total float (working days) at or below which a task is critical                             |
| `locale`, `currency`         | `"en-GB"`, data or `"GBP"` | Formatting                                                                                  |
| `today`                      | viewer's date              | `() => "YYYY-MM-DD"`, for the today line and overdue checks                                 |
| `on`                         | none                       | `{eventName: handler}` registered before the first load                                     |
| `eventTarget`, `eventPrefix` | host, `"gantt"`            | Where DOM `CustomEvent` mirrors are dispatched, and their prefix                            |

### View (`Gantt`)

| Option                                                                       | Default                                    | Meaning                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zoom`                                                                       | `"week"`                                   | `"day"`, `"week"`, `"month"` or `"quarter"`                                                                                                                                                                                                                                                    |
| `layout`                                                                     | `"grid"`                                   | `"timeline"` hides the task grid and gives the timeline the full width; task names become bar labels (inside when they fit, else beside, never off the edge). The rows stay keyboard- and screen-reader-reachable through a visually hidden treegrid, with the focused bar outlined (ADR-0010) |
| `fit`                                                                        | none                                       | `"width"` sizes the day so the whole programme (first start to last finish, plus 2%) fits the width without scrolling; refits on resize and after edits, never mid-drag. `setZoom()` turns it off                                                                                              |
| `minDayWidth`                                                                | `4`                                        | Smallest fitted day in pixels; below it the timeline scrolls                                                                                                                                                                                                                                   |
| `readOnly`                                                                   | `false`                                    | No dragging or editing; keyboard navigation and tooltips still work                                                                                                                                                                                                                            |
| `columns`, `hiddenColumns`                                                   | WBS, name, start, finish, duration         | Grid columns, built-in keys or `{key, title, width, value, align}`                                                                                                                                                                                                                             |
| `height`, `rowHeight`, `gridWidth`                                           | `480px`, 32 (40 on touch), auto            | Sizes (also the `--sg-height` and `--sg-row-height` tokens)                                                                                                                                                                                                                                    |
| `showCriticalPath`                                                           | `true`                                     | Highlight the critical path                                                                                                                                                                                                                                                                    |
| `showBaseline`                                                               | `null`                                     | Baseline id to draw as ghost bars                                                                                                                                                                                                                                                              |
| `markers`                                                                    | all on                                     | `{today, dataDate, contractCompletion}` lines                                                                                                                                                                                                                                                  |
| `barLabels`                                                                  | `true` (`"inside"` in the timeline layout) | `false`, `true` (beside the bar) or `"inside"` (inside when it fits)                                                                                                                                                                                                                           |
| `scrollTo`                                                                   | `"start"` (just before the first task)     | `"start"`, `"today"` or an ISO date                                                                                                                                                                                                                                                            |
| `editor`                                                                     | `"builtin"`                                | `builtinEditor` (from `streamlined-gantt/editor`), `"none"`, or `(task, {gantt, readOnly}) => void` for your own. `"builtin"` uses the registered dialog: included in the script-tag build, opt-in for ES modules                                                                              |
| `tooltip`                                                                    | built-in                                   | `false` or `(task, context) => string \| Node \| trustedHTML(...)`                                                                                                                                                                                                                             |
| `contextMenu`                                                                | built-in                                   | `false` or `{items: [...]}`                                                                                                                                                                                                                                                                    |
| `toolbar`                                                                    | none                                       | `buildToolbar` from `streamlined-gantt/toolbar` (`true` in the script-tag build)                                                                                                                                                                                                               |
| `confirmDelete`                                                              | `true`                                     | Ask before removing a task from the UI                                                                                                                                                                                                                                                         |
| `strings`                                                                    | English                                    | UI text and ARIA labels, for translation                                                                                                                                                                                                                                                       |
| `theme`, `categories`, `categoryOf`, `taskClass`, `taskStyle`, `colorScheme` | none                                       | See [theming.md](theming.md)                                                                                                                                                                                                                                                                   |

## Reading data

| Method                                                                      | Returns                                                                                         |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `getTask(id)`                                                               | Frozen snapshot with stored and derived values (dates, float, critical, level, summary, fields) |
| `getTasks(filter?)`, `getLink(id)`, `getLinks(taskId?)`, `getDelayEvents()` | Snapshots                                                                                       |
| `toJSON()`                                                                  | Stored programme data, deep-equal to what was loaded plus edits                                 |
| `getChanges()`, `isDirty()`, `markClean()`                                  | Changeset since the last `load`/`markClean`                                                     |
| `getProjectSummary(options?)`                                               | Totals, payment schedule and time-phased series (for charts)                                    |
| `getPaymentSchedule()`, `getFieldTotals(keys, filter?)`                     | Money summaries                                                                                 |
| `schedule()`                                                                | Runs the scheduler and returns its result (dates, float, violations)                            |

## Editing

Every edit is a transaction. Each method returns `Promise<{committed, transactionId, reason?}>`,
emits cancelable `before-*` events, then exactly one `change`, and records undo. Rejected edits
emit `edit-rejected` with a `reason`: `vetoed`, `error`, `timeout`, `locked`, `cycle`,
`validation`, `not-found` or `destroyed`.

| Method                                                                          |                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `addTask(task, options?)`, `updateTask(id, patch)`, `removeTask(id, {cascade})` | Tasks                                                               |
| `indentTask(id)`, `outdentTask(id)`                                             | Outline                                                             |
| `addLink(link)`, `updateLink(id, patch)`, `removeLink(id)`                      | Dependencies (cycles are refused)                                   |
| `addDelayEvent`, `updateDelayEvent`, `removeDelayEvent`                         | Delay bands                                                         |
| `setProject(values)`, `setCalendar(id, calendar)`, `captureBaseline(options?)`  | Programme-level                                                     |
| `batch(fn)`                                                                     | Several edits as one transaction and one undo step                  |
| `applyPatch(changeset, {undoable})`                                             | Server changes, `{tasks: {add, update, remove}, links: …, project}` |
| `undo()`, `redo()`, `canUndo()`, `canRedo()`                                    | History                                                             |
| `whenIdle()`, `isIdle()`                                                        | Wait for pending approvals                                          |
| `load(data)`                                                                    | Replace the programme (validated)                                   |

## View control (`Gantt`)

| Method                                                                           |                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `setZoom(zoom)`, `zoomIn()`, `zoomOut()`, `fitToRange(from, to)`, `setFit(fit)`  | Timescale                                      |
| `scrollToDate(date)`, `scrollToTask(id)`, `focusTask(id)`                        | Navigation                                     |
| `select(ids)`, `getSelection()`, `clearSelection()`, `selectLink(id)`            | Selection                                      |
| `collapse(id)`, `expand(id)`, `toggle(id)`, `collapseAll()`, `expandAll(level?)` | Outline                                        |
| `setReadOnly(bool)`, `setCriticalPathVisible(bool)`, `setBaselineVisible(id)`    | Display                                        |
| `setFilter(predicate)`, `setLookahead({weeks})`                                  | Filtering and lookahead                        |
| `openEditor(id)`, `openContextMenu(id)`, `openLinkPicker(id)`                    | UI                                             |
| `setTheme(theme)`, `setCategories(map)`, `refreshTheme()`                        | Theming                                        |
| `refresh()`, `destroy()`                                                         | Re-render, and release everything (idempotent) |

## Optional entries

| Import                       | Exports                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `streamlined-gantt/engine`   | `schedule`, `Calendar`, date helpers, `validateProgramme`, `projectSummary`, `paymentSchedule`, `fromGovUkBankHolidays`, `addWorkingDays(date, n, calendar)` and more. No DOM. |
| `streamlined-gantt/events`   | `EVENT_NAMES`, the event catalogue                                                                                                                                             |
| `streamlined-gantt/print`    | `printProgramme`, `buildDocument`, `toSVG`, `exportPNG`, `printDocumentHTML`, `installPrint`                                                                                   |
| `streamlined-gantt/io/mspdi` | `toMSPDI`, `fromMSPDI`, `MspdiParseError` (see [mspdi.md](mspdi.md))                                                                                                           |
| `streamlined-gantt/io/csv`   | `exportCSV(gantt)`, `programmeToCSV`                                                                                                                                           |
| `streamlined-gantt/health`   | `check(gantt)`: SCL/CIOB programme health findings                                                                                                                             |
| `streamlined-gantt/toolbar`  | `buildToolbar`                                                                                                                                                                 |
| `streamlined-gantt/editor`   | `builtinEditor`, `openTaskEditor`, `defaultEditorFields`                                                                                                                       |

## Keyboard

| Keys                               | Action                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| Arrow keys, Home/End, Page Up/Down | Move between rows and cells (treegrid)                                                 |
| Alt + Left/Right                   | Move the task one working day                                                          |
| Alt + Shift + Left/Right           | Shorten or lengthen by one working day                                                 |
| Enter or F2                        | Edit the cell (opens the editor in the timeline layout); Ctrl + Enter opens the editor |
| Ctrl + K                           | Link to another task (picker)                                                          |
| Shift + F10 or the Menu key        | Context menu                                                                           |
| Delete                             | Remove the task (with confirmation)                                                    |
| Ctrl + Z, Ctrl + Y                 | Undo and redo                                                                          |
| Escape                             | Cancel a drag or close a dialog                                                        |
