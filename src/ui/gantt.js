// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toDay, toISO, today as todayDay } from "../engine/dates.js";
import { formatDate, formatLongDate } from "../engine/format.js";
import { ancestorsOf } from "../engine/graph.js";
import { isComplete, isLocked, schedulingCalendar } from "../engine/model.js";
import { schedule as runSchedule } from "../engine/scheduler.js";
import { wouldCreateCycle } from "../engine/graph.js";
import { ProgrammeController } from "../model/controller.js";
import { buildColumns } from "./columns.js";
import { html, setAttributes } from "./dom.js";
import { GridView } from "./grid-view.js";
import { KeyboardController } from "./keyboard.js";
import { PointerController } from "./pointer.js";
import { TimeScale, ZOOM_LEVELS, ZOOM_ORDER, zoomForDayWidth } from "./scale.js";
import { DEFAULT_STRINGS, fill } from "./strings.js";
import { startCellEdit } from "./cell-editor.js";
import { confirmDialog } from "./dialog.js";
import { ContextMenu } from "./menu.js";
import { openLinkPicker } from "./picker.js";
import { Tooltip } from "./tooltip.js";
import { applyTheme, categoryTokens, lengthToken, taskAppearance } from "./theme.js";
import { TimelineView } from "./timeline-view.js";

/**
 * The interactive programme: a treegrid on the left, an SVG timeline on the
 * right, drag and keyboard editing, and the full controller API (data, CRUD,
 * events, undo) inherited from {@link ProgrammeController}.
 *
 * @example
 * import { Gantt } from "streamlined-gantt";
 * const gantt = new Gantt(document.querySelector("#programme"), { data, zoom: "week" });
 * gantt.on("change", (event) => save(event.changes));
 *
 * @module ui/gantt
 */

/**
 * @typedef {import("../model/controller.js").ControllerOptions & {
 *   zoom?: import("./scale.js").ZoomLevel,
 *   layout?: "grid"|"timeline",
 *   fit?: "width"|null,
 *   minDayWidth?: number,
 *   readOnly?: boolean,
 *   columns?: (import("./columns.js").ColumnConfig|string)[],
 *   hiddenColumns?: string[],
 *   rowHeight?: number,
 *   overscan?: number,
 *   strings?: Partial<typeof DEFAULT_STRINGS>,
 *   showCriticalPath?: boolean,
 *   showBaseline?: string|null,
 *   markers?: {today?: boolean, dataDate?: boolean, contractCompletion?: boolean},
 *   barLabels?: boolean|"inside",
 *   theme?: Record<string, string|number|null>,
 *   categories?: Record<string, import("./theme.js").CategoryColour>,
 *   categoryOf?: (task: Readonly<Record<string, any>>) => unknown,
 *   taskClass?: (task: Readonly<Record<string, any>>) => string|string[]|null|undefined,
 *   taskStyle?: (task: Readonly<Record<string, any>>) => Record<string, string>|null|undefined,
 *   colorScheme?: "auto"|"light"|"dark",
 *   scrollTo?: "start"|"today"|string,
 *   height?: string,
 *   gridWidth?: number,
 *   editor?: "builtin"|"none"|((task: Readonly<Record<string, any>>, context: {gantt: Gantt, readOnly: boolean}) => unknown),
 *   contextMenu?: false|{items?: object[]},
 *   tooltip?: false|((task: Readonly<Record<string, any>>, context: object) => unknown),
 *   toolbar?: boolean|((gantt: Gantt) => HTMLElement),
 *   confirmDelete?: boolean,
 * }} GanttOptions
 */

let instanceCounter = 0;

/** @type {((gantt: Gantt) => HTMLElement)|null} */
let defaultToolbar = null;

/** @type {((gantt: Gantt, taskId: string) => boolean)|null} */
let defaultEditor = null;

/**
 * Makes `editor: "builtin"` (the default) use this dialog. The script-tag
 * build registers the built-in one; ES module users pass
 * `editor: builtinEditor` from "streamlined-gantt/editor", or their own.
 * @param {(gantt: Gantt, taskId: string) => boolean} open
 */
export function setDefaultEditor(open) {
  defaultEditor = open;
}

/**
 * Makes `toolbar: true` use this toolbar. The script-tag build registers the
 * built-in one; ES module users pass `toolbar: buildToolbar` instead, so the
 * core bundle does not carry a toolbar most hosts replace with their own.
 * @param {(gantt: Gantt) => HTMLElement} factory
 */
export function setDefaultToolbar(factory) {
  defaultToolbar = factory;
}

export class Gantt extends ProgrammeController {
  /**
   * @param {HTMLElement} host the element the chart renders into (light DOM)
   * @param {GanttOptions} [options]
   */
  constructor(host, options = {}) {
    if (!(host instanceof HTMLElement)) throw new TypeError("Gantt needs a host element");
    const toolbar = options.toolbar === true ? defaultToolbar : options.toolbar;
    if (options.toolbar && typeof toolbar !== "function")
      throw new TypeError(
        'toolbar: true needs the built-in toolbar: pass toolbar: buildToolbar from "streamlined-gantt/toolbar"',
      );
    const { data, ...rest } = options;
    super({ ...rest, eventTarget: rest.eventTarget === undefined ? host : rest.eventTarget });
    this.host = host;
    instanceCounter += 1;
    this.uid = `sg${instanceCounter}`;
    /** @type {Record<string, any>} */
    this.options = {
      zoom: "week",
      readOnly: false,
      overscan: 10,
      showCriticalPath: true,
      showBaseline: null,
      markers: { today: true, dataDate: true, contractCompletion: true },
      scrollTo: "start",
      editor: "builtin",
      confirmDelete: true,
      minDayWidth: 4,
      ...this.options,
    };
    this.timelineOnly = this.options.layout === "timeline";
    this.options.barLabels ??= this.timelineOnly ? "inside" : true;
    this.fitWidth = this.options.fit === "width";
    this.strings = { ...DEFAULT_STRINGS, ...(options.strings ?? {}) };
    /** @type {import("./scale.js").ZoomLevel} */
    this.zoom = ZOOM_LEVELS[this.options.zoom] ? this.options.zoom : "week";
    this.readOnly = Boolean(this.options.readOnly);
    this.showCriticalPath = this.options.showCriticalPath !== false;
    this.baselineId = this.options.showBaseline ?? null;
    /** @type {Set<string>} */
    this.collapsed = new Set();
    /** @type {Set<string>} */
    this.selection = new Set();
    this.selectedLinkId = null;
    /** @type {{taskId: string|null, column: number}} */
    this.focus = { taskId: null, column: 0 };
    /** @type {Set<string>} */
    this.pending = new Set();
    /** @type {Map<string, {field: string, message: string}>} */
    this.invalidCells = new Map();
    /** @type {{taskId: string, dates: Map<string, {start: number, finish: number}>, progress?: number}|null} */
    this.preview = null;
    /** @type {((task: Readonly<Record<string, any>>) => boolean)|null} */
    this.filter = null;
    /** @type {{from: number, to: number, weeks: number}|null} */
    this.lookahead = null;
    this.rowCache = null;
    this.scaleCache = null;
    this.frame = 0;
    this.scrollTimer = 0;
    this.focusAfterRender = false;
    this.firstRenderDone = false;
    this.scrollShift = 0;
    /** @type {any} */
    this.lastChange = null;
    this.buildDom();
    this.grid = new GridView(this);
    this.timeline = new TimelineView(this);
    this.canvas.append(this.grid.element, this.timeline.element);
    this.pointer = new PointerController(this);
    this.keyboard = new KeyboardController(this);
    this.tooltip = new Tooltip(this);
    this.menu = new ContextMenu(this);
    /** @type {import("./dialog.js").DialogHandle|null} */
    this.activeDialog = null;
    /** @type {{taskId: string, columnIndex: number}|null} */
    this.editingCell = null;
    /** @type {any} */
    this.lastRejection = null;
    if (toolbar) this.root.prepend(toolbar(this));
    this.on("change", (event) => {
      this.lastChange = event;
    });
    this.on("edit-rejected", (event) => this.onRejected(event));
    this.observeSize();
    if (data) this.load(data);
    else this.render();
  }

  /* --------------------------------------------------------------- DOM */

  buildDom() {
    this.root = html("div", { class: "sg-root", "data-zoom": this.zoom, id: this.uid });
    if (this.options.height) this.root.style.setProperty("--sg-height", this.options.height);
    applyTheme(this.root, { ...categoryTokens(this.options.categories), ...this.options.theme });
    this.scroller = html("div", { class: "sg-scroller" });
    this.canvas = html("div", { class: "sg-canvas" });
    this.scroller.append(this.canvas);
    this.live = html("div", { class: "sg-sr-only", "aria-live": "polite", "aria-atomic": "true" });
    this.errorRegion = html("div", { class: "sg-sr-only", id: `${this.uid}-error`, role: "alert" });
    this.hint = html("div", { class: "sg-sr-only", id: `${this.uid}-hint` }, [
      this.strings.dragHint,
    ]);
    this.root.append(this.scroller, this.live, this.errorRegion, this.hint);
    this.host.append(this.root);
    this.onScroll = () => {
      this.tooltip?.hide();
      this.requestRender();
      this.scheduleScrollEvent();
    };
    this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.updateRootState();
    this.readMetrics();
  }

  /* ------------------------------------------------------------ theming */

  /**
   * Sets theme tokens on this chart: `{bar: "#0f766e", barRadius: "0px"}`,
   * `{"--sg-bar": …}` or `{"bar-critical": …}` all work; `null` removes a
   * token so the stylesheet default (or the host's CSS) applies again.
   * @param {Record<string, string|number|null>} theme
   */
  setTheme(theme) {
    applyTheme(this.root, theme);
    this.refreshTheme();
  }

  /**
   * Sets category colours, `{roofing: "#c2410c", scaffold: {color: "#334155", text: "#ffffff"}}`.
   * Tasks pick a category from `task.category`, or from `options.categoryOf(task)`.
   * @param {Record<string, import("./theme.js").CategoryColour|null>} categories
   */
  setCategories(categories) {
    this.setTheme(categoryTokens(categories));
  }

  /** Re-reads geometry tokens after CSS changed outside {@link setTheme}, and redraws. */
  refreshTheme() {
    this.readMetrics();
    this.themeVersion = (this.themeVersion ?? 0) + 1;
    this.rowCache = null;
    this.render();
  }

  /** Reads the geometry tokens the renderer needs as numbers. */
  readMetrics() {
    const computed = getComputedStyle(this.root);
    this.metrics = {
      rowHeight: lengthToken(computed, "--sg-row-height", 0),
      barHeight: lengthToken(computed, "--sg-bar-height", 0),
      summaryHeight: lengthToken(computed, "--sg-summary-height", 0),
      milestoneSize: lengthToken(computed, "--sg-milestone-size", 0),
      barRadius: lengthToken(computed, "--sg-bar-radius", 3),
    };
  }

  /**
   * Classes, styles and custom colour for a task (category, `style.color`,
   * `taskClass`, `taskStyle`).
   * @param {Readonly<Record<string, any>>} task
   * @returns {import("./theme.js").Appearance}
   */
  appearanceOf(task) {
    return taskAppearance(task, this.options);
  }

  observeSize() {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(this.scroller);
  }

  updateRootState() {
    setAttributes(this.root, {
      class: [
        "sg-root",
        this.readOnly ? "sg-readonly" : "",
        this.timelineOnly ? "sg-layout-timeline" : "",
        this.fitWidth ? "sg-fit" : "",
        this.showCriticalPath ? "sg-show-critical" : "",
        this.coarsePointer() ? "sg-coarse" : "",
        this.options.colorScheme === "light" || this.options.colorScheme === "dark"
          ? `sg-scheme-${this.options.colorScheme}`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      "data-zoom": this.zoom,
    });
  }

  /** @returns {boolean} */
  coarsePointer() {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  }

  /** @returns {number} drag-handle hit width; at least 24 px on touch screens (WCAG 2.5.8) */
  handleSize() {
    return this.coarsePointer() ? 24 : 10;
  }

  /** @returns {number} */
  get rowHeight() {
    if (this.options.rowHeight) return this.options.rowHeight;
    if (this.metrics?.rowHeight) return this.metrics.rowHeight;
    return this.coarsePointer() ? 40 : 32;
  }

  /** @returns {number} */
  get headerHeight() {
    return this.root.classList.contains("sg-has-markers") ? 66 : 48;
  }

  /* ------------------------------------------------- controller hooks */

  onDataReplaced() {
    this.collapsed = new Set(
      this.store
        .list("tasks")
        .filter((task) => task.collapsed)
        .map((task) => task.id),
    );
    const known = new Set(this.store.list("tasks").map((task) => task.id));
    this.selection = new Set([...this.selection].filter((id) => known.has(id)));
    if (!known.has(this.focus.taskId))
      this.focus = { taskId: this.store.list("tasks")[0]?.id ?? null, column: 0 };
    this.preview = null;
    this.invalidate();
    this.scaleCache = null;
    if (!this.grid) return;
    this.render();
    this.scrollToInitialPosition();
  }

  invalidate() {
    super.invalidate();
    this.rowCache = null;
  }

  /** @param {import("../model/controller.js").ProgrammeController extends never ? never : any} tx */
  onCommitted(tx) {
    void tx;
    this.invalidCells.clear();
    this.render();
  }

  /**
   * @param {any} tx
   * @param {boolean} optimistic
   */
  onApprovalPending(tx, optimistic) {
    this.pending = new Set(tx.touchedTaskIds);
    if (!optimistic) this.root.setAttribute("aria-busy", "true");
    this.announce(this.strings.pending);
    this.render();
  }

  /** @param {any} _tx */
  onTransactionSettled(_tx) {
    if (!this.pending.size && !this.root.hasAttribute("aria-busy")) return;
    this.pending = new Set();
    this.root.removeAttribute("aria-busy");
    this.render();
  }

  /** @param {any} event */
  onRejected(event) {
    this.lastRejection = event;
    if (event.reason === "validation" && event.taskIds?.[0]) {
      this.errorRegion.textContent = event.message;
    }
    if (event.cause !== "api")
      this.announce(fill(this.strings.rejected, { message: event.message }));
    this.render();
  }

  /* --------------------------------------------------------- rows */

  /**
   * The visible rows: tree order, minus collapsed descendants, filtered by
   * the filter and lookahead (keeping ancestors of matching tasks).
   * @returns {import("./columns.js").Row[]}
   */
  rows() {
    if (this.rowCache) return this.rowCache.rows;
    const analysis = this.analysis;
    const hierarchy = analysis.tree.hierarchy;
    const matches = this.matchingIds();
    const baseline = this.visibleBaseline() ?? this.store.data.baselines?.[0] ?? null;
    /** @type {import("./columns.js").Row[]} */
    const rows = [];
    const hiddenUnder = new Set();
    for (const id of analysis.order) {
      const parent = hierarchy.parentOf.get(id);
      if (parent && (this.collapsed.has(parent) || hiddenUnder.has(parent))) {
        hiddenUnder.add(id);
        continue;
      }
      if (matches && !matches.has(id)) continue;
      rows.push(this.buildRow(id, baseline));
    }
    const index = new Map(rows.map((row, position) => [row.id, position]));
    this.rowCache = { rows, index };
    return rows;
  }

  /**
   * @param {string} id
   * @param {import("../engine/types.js").Baseline|null} baseline used for the variance column
   * @returns {import("./columns.js").Row}
   */
  buildRow(id, baseline) {
    const analysis = this.analysis;
    const hierarchy = analysis.tree.hierarchy;
    const dates = analysis.resolved.get(id);
    const hasChildren = (hierarchy.childrenOf.get(id)?.length ?? 0) > 0;
    const baselineDates = baseline?.tasks?.[id];
    const calendar = analysis.calendar;
    const variance =
      dates && baselineDates
        ? calendar.indexOf(dates.finish + 1) - calendar.indexOf(toDay(baselineDates.finish) + 1)
        : null;
    return {
      id,
      task: analysis.taskById.get(id),
      dates,
      level: analysis.depth.get(id) ?? 1,
      summary: analysis.tree.summaries.has(id),
      milestone: Boolean(dates?.milestone),
      hasChildren,
      expanded: hasChildren && !this.collapsed.has(id),
      schedule: analysis.schedule.tasks.get(id),
      values: analysis.fieldValues.get(id) ?? {},
      variance,
    };
  }

  /**
   * Ids allowed by the filter and lookahead, plus their ancestors; null when neither is set.
   * @returns {Set<string>|null}
   */
  matchingIds() {
    if (!this.filter && !this.lookahead) return null;
    const analysis = this.analysis;
    const allowed = new Set();
    for (const id of analysis.order) {
      if (analysis.tree.summaries.has(id)) continue;
      if (!this.passesFilters(id)) continue;
      allowed.add(id);
      for (const ancestor of ancestorsOf(id, analysis.tree.hierarchy)) allowed.add(ancestor);
    }
    return allowed;
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  passesFilters(id) {
    const dates = this.analysis.resolved.get(id);
    if (this.lookahead) {
      const overlaps =
        dates && dates.start <= this.lookahead.to && dates.finish >= this.lookahead.from;
      if (!overlaps) return false;
    }
    return this.filter ? Boolean(this.filter(this.getTask(id))) : true;
  }

  /**
   * @param {string} id
   * @returns {import("./columns.js").Row|undefined}
   */
  rowById(id) {
    const rows = this.rows();
    const position = this.rowCache.index.get(id);
    return position === undefined ? undefined : rows[position];
  }

  /**
   * @param {string} id
   * @returns {number} -1 when the task is not visible
   */
  rowPosition(id) {
    this.rows();
    return this.rowCache.index.get(id) ?? -1;
  }

  /**
   * @param {number} y body y in pixels
   * @returns {import("./columns.js").Row|undefined}
   */
  rowAtY(y) {
    return this.rows()[Math.floor(y / this.rowHeight)];
  }

  /** @returns {number} */
  visibleRowCount() {
    return Math.max(
      1,
      Math.floor((this.scroller.clientHeight - this.headerHeight) / this.rowHeight),
    );
  }

  /* ---------------------------------------------------------- columns */

  /**
   * True on narrow containers (phones), where the grid shows only the task
   * name so the timeline stays usable.
   * @returns {boolean}
   */
  isCompact() {
    const width = this.scroller?.clientWidth ?? 0;
    return width > 0 && width < (this.options.compactBelow ?? 720);
  }

  /** @returns {import("./columns.js").Column[]} */
  get columns() {
    const compact = this.isCompact() || this.timelineOnly;
    const width = this.scroller?.clientWidth ?? 0;
    const key = `${this.options.locale}|${this.currency}|${this.readOnly}|${compact}|${compact ? width : 0}`;
    if (this.columnCache?.key === key) return this.columnCache.columns;
    const columns = buildColumns(compact ? ["name"] : this.options.columns, {
      locale: this.options.locale,
      currency: this.currency,
      strings: this.strings,
      fields: this.fields,
      hidden: this.options.hiddenColumns,
    });
    if (compact && !this.timelineOnly)
      for (const column of columns)
        column.width = Math.round(Math.min(220, Math.max(120, width * 0.42)));
    this.columnCache = { key, columns };
    return columns;
  }

  /** @returns {number} */
  gridWidth() {
    if (this.timelineOnly) return 0;
    if (this.isCompact()) return this.grid.width(this.columns);
    return this.options.gridWidth ?? this.grid.width(this.columns);
  }

  /* -------------------------------------------------------- timescale */

  /** @returns {TimeScale} */
  get scale() {
    const schedule = this.analysis.schedule;
    const days = [
      schedule.projectStart,
      schedule.projectFinish,
      this.store.data.dataDate,
      this.store.data.contractCompletion,
    ]
      .filter(Boolean)
      .map((date) => toDay(date));
    for (const marker of this.store.list("markers")) days.push(toDay(marker.date));
    if (this.preview)
      for (const dates of this.preview.dates.values()) days.push(dates.start, dates.finish);
    if (!days.length) days.push(todayDay());
    const start = Math.min(...days);
    const finish = Math.max(...days);
    const cached = this.scaleCache;
    const fitted = this.fittedScale(start, finish, cached);
    if (fitted) return fitted;
    const fits =
      cached &&
      !cached.fitKey &&
      cached.zoom === this.zoom &&
      start >= cached.from &&
      finish <= cached.end - 7;
    if (fits && cached.locale === this.options.locale) return cached;
    const dayWidth = ZOOM_LEVELS[this.zoom].dayWidth;
    const scale = this.useScale(
      start,
      { zoom: this.zoom, lead: Math.max(2, Math.ceil(24 / dayWidth)) },
      finish,
    );
    if (cached?.dayWidth === dayWidth) this.scrollShift += (cached.start - scale.start) * dayWidth;
    return scale;
  }

  /**
   * The fit-to-width scale (`fit: "width"`): the programme from first start to
   * last finish, plus a 2% margin, across the visible timeline width, at no
   * less than `minDayWidth` (below that the timeline scrolls). Kept as it is
   * during a drag so bars do not jump; refitted after the drop.
   * @param {number} start
   * @param {number} finish
   * @param {any} cached
   * @returns {TimeScale|null} null when not fitting or the chart has no width yet
   */
  fittedScale(start, finish, cached) {
    if (!this.fitWidth) return null;
    if (this.preview && cached?.fitKey) return cached;
    const available = this.scroller.clientWidth - this.gridWidth() - 1;
    if (available <= 0) return null;
    const key = `${available}|${start}|${finish}|${this.options.locale}`;
    if (cached?.fitKey === key) return cached;
    const margin = Math.max(1, Math.round((finish - start + 1) * 0.02));
    const dayWidth = Math.max(
      this.options.minDayWidth,
      available / (finish - start + 1 + 2 * margin),
    );
    const scale = this.useScale(
      start,
      { zoom: zoomForDayWidth(dayWidth), dayWidth, lead: margin, trail: margin },
      finish,
    );
    scale.fitKey = key;
    return scale;
  }

  /**
   * @param {number} start
   * @param {Record<string, any>} options
   * @param {number} finish
   * @returns {TimeScale & Record<string, any>}
   */
  useScale(start, options, finish) {
    const scale = /** @type {any} */ (
      new TimeScale({
        start,
        finish,
        locale: this.options.locale,
        strings: this.strings,
        ...options,
      })
    );
    scale.from = start;
    this.scaleCache = scale;
    this.timeline?.invalidate();
    return scale;
  }

  /** @returns {{scale: TimeScale, rowHeight: number}} */
  frameMetrics() {
    return { scale: this.scale, rowHeight: this.rowHeight };
  }

  /* ------------------------------------------------------------- render */

  /** Schedules a render on the next animation frame. */
  requestRender() {
    if (this.frame || this.destroyed) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Renders synchronously. */
  render() {
    if (this.destroyed || !this.grid) return;
    if (this.frame) {
      window.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    const startedAt = performance.now();
    if (!this.firstRenderDone) performance.mark?.(`sg:render:start:${this.uid}`);
    const rows = this.rows();
    const scale = this.scale;
    const rowHeight = this.rowHeight;
    const gridWidth = this.gridWidth();
    this.canvas.style.setProperty("width", `${gridWidth + scale.width}px`);
    this.root.style.setProperty("--sg-row-px", `${rowHeight}px`);
    if (this.scrollShift) {
      this.scroller.scrollLeft += this.scrollShift;
      this.scrollShift = 0;
    }
    this.root.classList.toggle("sg-has-markers", this.markerLines(scale).length > 0);
    const scrollTop = this.scroller.scrollTop;
    const viewportHeight = Math.max(this.scroller.clientHeight - this.headerHeight, rowHeight);
    const overscan = this.options.overscan;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const last = Math.min(
      rows.length,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
    );
    const xFrom = this.scroller.scrollLeft;
    const xTo = xFrom + Math.max(this.scroller.clientWidth - gridWidth, 0);
    const focusWasInGrid = this.grid.element.contains(document.activeElement);
    this.grid.render({ rows, first, last, columns: this.columns, rowHeight });
    if (focusWasInGrid && !this.grid.element.contains(document.activeElement))
      this.focusAfterRender = true;
    this.timeline.render({
      rows,
      first,
      last,
      scale,
      rowHeight,
      xFrom,
      xTo,
      rowIndex: this.rowCache.index,
    });
    if (this.focusAfterRender) {
      this.focusAfterRender = false;
      this.grid.cell(this.focus.taskId, this.focus.column)?.focus({ preventScroll: true });
    }
    const durationMs = performance.now() - startedAt;
    if (!this.firstRenderDone) {
      this.firstRenderDone = true;
      performance.mark?.(`sg:render:end:${this.uid}`);
      this.firstRenderMs = durationMs;
    }
    this.emit("render", { firstRow: first, lastRow: last, durationMs });
  }

  /** Recomputes everything and renders (for example after a theme or size change). */
  refresh() {
    this.invalidate();
    this.scaleCache = null;
    this.columnCache = null;
    this.timeline.invalidate();
    this.grid.columnsSignature = "";
    this.render();
  }

  scheduleScrollEvent() {
    if (this.scrollTimer) window.clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => {
      this.scrollTimer = 0;
      const scale = this.scale;
      const rows = this.rows();
      const firstRow = Math.floor(this.scroller.scrollTop / this.rowHeight);
      const lastRow = Math.min(rows.length - 1, firstRow + this.visibleRowCount());
      const fromDay = scale.dayAt(this.scroller.scrollLeft);
      const toDayNumber = scale.dayAt(
        this.scroller.scrollLeft + Math.max(this.scroller.clientWidth - this.gridWidth(), 0),
      );
      this.emit("scroll", {
        fromDate: toISO(fromDay),
        toDate: toISO(toDayNumber),
        firstRow,
        lastRow,
      });
    }, 100);
  }

  /* ------------------------------------------------------- view helpers */

  /**
   * Dates to draw for a row: the drag preview when one is active.
   * @param {import("./columns.js").Row} row
   * @returns {{start: number, finish: number}|undefined}
   */
  displayDates(row) {
    const preview = this.preview?.dates.get(row.id);
    if (preview) return preview;
    if (this.preview && row.summary) return this.previewSummary(row);
    return row.dates;
  }

  /**
   * @param {import("./columns.js").Row} row
   * @returns {{start: number, finish: number}|undefined}
   */
  previewSummary(row) {
    if (!row.dates) return undefined;
    let start = Infinity;
    let finish = -Infinity;
    const hierarchy = this.analysis.tree.hierarchy;
    const stack = [...(hierarchy.childrenOf.get(row.id) ?? [])];
    while (stack.length) {
      const id = stack.pop();
      const children = hierarchy.childrenOf.get(id) ?? [];
      if (children.length) {
        stack.push(...children);
        continue;
      }
      const dates = this.preview.dates.get(id) ?? this.analysis.resolved.get(id);
      if (!dates) continue;
      start = Math.min(start, dates.start);
      finish = Math.max(finish, dates.finish);
    }
    return Number.isFinite(start) ? { start, finish } : row.dates;
  }

  /**
   * @param {string} id
   * @returns {number|undefined}
   */
  previewProgress(id) {
    return this.preview?.taskId === id ? this.preview.progress : undefined;
  }

  /**
   * True when a milestone sits at the end of its date (ADR-0003).
   * @param {string} id
   * @returns {boolean}
   */
  isFinishAnchored(id) {
    return this.analysis.schedule.tasks.get(id)?.anchor === "finish";
  }

  /**
   * CSS classes and capabilities of a row's bar.
   * @param {import("./columns.js").Row} row
   * @returns {{classes: string[], editable: boolean, resizable: boolean, critical: boolean}}
   */
  taskState(row) {
    const critical = this.showCriticalPath && Boolean(row.schedule?.critical);
    const locked = isLocked(row.task);
    const classes = ["sg-task", `sg-type-${row.summary ? "summary" : (row.task.type ?? "task")}`];
    if (row.milestone) classes.push("sg-is-milestone");
    if (critical) classes.push("sg-critical");
    if (this.selection.has(row.id)) classes.push("sg-selected");
    if (this.timelineOnly && this.focus.taskId === row.id) classes.push("sg-focused");
    if (this.pending.has(row.id)) classes.push("sg-pending");
    if (locked) classes.push("sg-locked");
    if (isComplete(row.task)) classes.push("sg-complete");
    if (this.preview?.dates.has(row.id)) classes.push("sg-previewing");
    if (row.task.className)
      classes.push(...String(row.task.className).split(/\s+/).filter(Boolean));
    const editable = !this.readOnly && !row.summary && !locked && Boolean(row.dates);
    return { classes, editable, resizable: editable && !row.milestone, critical };
  }

  /**
   * Vertical marker lines: today, data date, contract completion and key dates.
   * @param {TimeScale} scale
   * @returns {{x: number, kind: string, label: string, title: string}[]}
   */
  markerLines(scale) {
    const markers = [];
    /** @type {{today?: boolean, dataDate?: boolean, contractCompletion?: boolean}} */
    const options = this.options.markers ?? {};
    const data = this.store.data;
    const add = (day, kind, label, endOfDay = false) => {
      if (!scale.contains(day)) return;
      const title = `${label}: ${formatDate(day, this.options.locale)}`;
      markers.push({ x: scale.x(endOfDay ? day + 1 : day), kind, label, title });
    };
    if (options.today !== false) add(toDay(this.todayISO()), "today", this.strings.today);
    if (options.dataDate !== false && data.dataDate)
      add(toDay(data.dataDate), "data-date", this.strings.dataDate);
    if (options.contractCompletion !== false && data.contractCompletion)
      add(toDay(data.contractCompletion), "completion", this.strings.contractCompletion, true);
    for (const marker of this.store.list("markers"))
      add(toDay(marker.date), marker.kind ?? "key-date", marker.label ?? marker.id, true);
    return markers;
  }

  /** @returns {string} */
  markerSignature() {
    const data = this.store.data;
    return JSON.stringify([
      this.todayISO(),
      data.dataDate,
      data.contractCompletion,
      data.markers,
      this.options.markers,
    ]);
  }

  /** @returns {string} */
  calendarSignature() {
    return JSON.stringify([this.store.data.calendars, this.store.data.defaultCalendar]);
  }

  /** @returns {{from: number, to: number}|null} */
  lookaheadWindow() {
    return this.lookahead ? { from: this.lookahead.from, to: this.lookahead.to } : null;
  }

  /** @returns {import("../engine/types.js").Baseline|null} */
  visibleBaseline() {
    if (!this.baselineId) return null;
    const baselines = this.store.list("baselines");
    if (this.baselineId === "current") return baselines.at(-1) ?? null;
    return baselines.find((baseline) => baseline.id === this.baselineId) ?? null;
  }

  /* ------------------------------------------------------------- preview */

  /**
   * Previews a dragged task's proposed dates and the cascade they cause.
   * @param {string} taskId
   * @param {{start: number, finish: number, progress?: number}} proposed
   * @returns {Map<string, {start: number, finish: number}>}
   */
  setPreview(taskId, proposed) {
    const dates = new Map([[taskId, { start: proposed.start, finish: proposed.finish }]]);
    const current = this.analysis.resolved.get(taskId);
    const moved =
      current && (current.start !== proposed.start || current.finish !== proposed.finish);
    if (moved && this.options.autoSchedule !== "off") {
      for (const change of this.previewCascade(taskId, proposed)) {
        if (change.id !== taskId)
          dates.set(change.id, { start: toDay(change.start), finish: toDay(change.finish) });
      }
    }
    this.preview = { taskId, dates, progress: proposed.progress };
    this.render();
    return dates;
  }

  /**
   * @param {string} taskId
   * @param {{start: number, finish: number}} proposed
   * @returns {import("../engine/scheduler.js").ScheduleResult["changed"]}
   */
  previewCascade(taskId, proposed) {
    const data = this.store.data;
    const calendar = this.calendar;
    const tasks = data.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const duration =
        task.type === "summary"
          ? undefined
          : calendar.workingDaysBetween(proposed.start, proposed.finish);
      return {
        ...task,
        start: toISO(proposed.start),
        finish: toISO(proposed.finish),
        duration: this.rowById(taskId)?.milestone ? 0 : duration,
      };
    });
    try {
      return runSchedule({
        tasks,
        links: data.links ?? [],
        calendar: schedulingCalendar(data),
        dataDate: data.dataDate ?? null,
        contractCompletion: data.contractCompletion ?? null,
        mode: this.options.autoSchedule === "tight" ? "tight" : "propagate",
        pinned: [taskId],
      }).changed;
    } catch {
      return [];
    }
  }

  clearPreview() {
    if (!this.preview) return;
    this.preview = null;
    this.render();
  }

  /**
   * Programme data including an uncommitted drag, for `getProjectSummary({preview: true})`.
   * @param {boolean} preview
   * @returns {import("../engine/types.js").Programme}
   */
  summaryData(preview) {
    if (!preview || !this.preview) return this.store.data;
    const data = this.store.data;
    const tasks = data.tasks.map((task) => {
      const dates = this.preview.dates.get(task.id);
      const progress = this.preview.taskId === task.id ? this.preview.progress : undefined;
      if (!dates && progress === undefined) return task;
      const next = { ...task };
      if (dates) {
        next.start = toISO(dates.start);
        next.finish = toISO(dates.finish);
        if (task.duration !== undefined && task.duration !== 0)
          next.duration = this.calendar.workingDaysBetween(dates.start, dates.finish);
      }
      if (progress !== undefined) next.progress = progress;
      return next;
    });
    return { ...data, tasks };
  }

  /**
   * @param {string} from
   * @param {string} to
   * @returns {boolean}
   */
  canLink(from, to) {
    if (from === to) return false;
    const exists = this.store.list("links").some((link) => link.from === from && link.to === to);
    return (
      !exists && !wouldCreateCycle(this.store.list("tasks"), this.store.list("links"), { from, to })
    );
  }

  /* --------------------------------------------------------- selection */

  /**
   * @param {string[]} ids
   * @param {{additive?: boolean, toggle?: boolean}} [options]
   */
  select(ids, options = {}) {
    const previous = new Set(this.selection);
    const next = options.additive ? new Set(previous) : new Set();
    for (const id of ids) {
      if (options.toggle && previous.has(id)) next.delete(id);
      else next.add(id);
    }
    this.selectedLinkId = null;
    this.applySelection(previous, next);
  }

  /**
   * @param {Set<string>} previous
   * @param {Set<string>} next
   */
  applySelection(previous, next) {
    const added = [...next].filter((id) => !previous.has(id));
    const removed = [...previous].filter((id) => !next.has(id));
    this.selection = next;
    this.render();
    if (added.length || removed.length)
      this.emit("selection-change", { selected: [...next], added, removed });
  }

  /** @param {string} id */
  selectLink(id) {
    this.selectedLinkId = id;
    this.applySelection(new Set(this.selection), new Set());
  }

  /** @returns {string[]} */
  getSelection() {
    return [...this.selection];
  }

  clearSelection() {
    this.applySelection(new Set(this.selection), new Set());
  }

  /**
   * Moves keyboard focus to a task's row, expanding its ancestors and scrolling it into view.
   * @param {string} taskId
   * @param {{column?: number, scroll?: boolean, focus?: boolean}} [options]
   */
  focusTask(taskId, options = {}) {
    const ancestors = ancestorsOf(taskId, this.analysis.tree.hierarchy);
    let expanded = false;
    for (const ancestor of ancestors) expanded = this.collapsed.delete(ancestor) || expanded;
    if (expanded) this.rowCache = null;
    this.focus = { taskId, column: options.column ?? this.focus.column ?? 0 };
    if (options.scroll !== false) this.scrollRowIntoView(taskId);
    this.focusAfterRender = options.focus !== false;
    this.render();
  }

  /** @param {string} taskId */
  scrollRowIntoView(taskId) {
    const position = this.rowPosition(taskId);
    if (position < 0) return;
    const top = position * this.rowHeight;
    const viewport = this.scroller.clientHeight - this.headerHeight;
    if (top < this.scroller.scrollTop) this.scroller.scrollTop = top;
    else if (top + this.rowHeight > this.scroller.scrollTop + viewport)
      this.scroller.scrollTop = top + this.rowHeight - viewport;
  }

  /* --------------------------------------------------------- tree state */

  /** @param {string} id */
  collapse(id) {
    if (this.collapsed.has(id) || !this.analysis.tree.summaries.has(id)) return;
    this.collapsed.add(id);
    this.rowCache = null;
    this.render();
    this.emit("expand-change", { taskId: id, expanded: false });
  }

  /** @param {string} id */
  expand(id) {
    if (!this.collapsed.delete(id)) return;
    this.rowCache = null;
    this.render();
    this.emit("expand-change", { taskId: id, expanded: true });
  }

  /** @param {string} id */
  toggle(id) {
    if (this.collapsed.has(id)) this.expand(id);
    else this.collapse(id);
  }

  collapseAll() {
    for (const id of this.analysis.tree.summaries) this.collapsed.add(id);
    this.rowCache = null;
    this.render();
  }

  /**
   * Expands everything, or only down to `level`.
   * @param {number} [level]
   */
  expandAll(level) {
    const depth = this.analysis.depth;
    this.collapsed = new Set(
      level === undefined
        ? []
        : [...this.analysis.tree.summaries].filter((id) => (depth.get(id) ?? 1) >= level),
    );
    this.rowCache = null;
    this.render();
  }

  /* ------------------------------------------------------- zoom & scroll */

  /**
   * @param {import("./scale.js").ZoomLevel} zoom
   */
  setZoom(zoom) {
    if (!ZOOM_LEVELS[zoom] || (zoom === this.zoom && !this.fitWidth)) return;
    const previous = this.zoom;
    const centre = this.centreDay();
    this.zoom = zoom;
    this.fitWidth = false;
    this.scaleCache = null;
    this.updateRootState();
    this.render();
    this.scrollToDate(toISO(centre), { align: "center" });
    this.emit("zoom-change", { zoom, previous });
  }

  /**
   * Turns fit-to-width on (`"width"`) or off (`null`, back to the zoom level).
   * @param {"width"|null} fit
   */
  setFit(fit) {
    this.fitWidth = fit === "width";
    this.scaleCache = null;
    this.updateRootState();
    this.render();
    this.scroller.scrollLeft = 0;
    this.scrollToInitialPosition();
  }

  zoomIn() {
    this.setZoom(ZOOM_ORDER[Math.max(0, ZOOM_ORDER.indexOf(this.zoom) - 1)]);
  }

  zoomOut() {
    this.setZoom(ZOOM_ORDER[Math.min(ZOOM_ORDER.length - 1, ZOOM_ORDER.indexOf(this.zoom) + 1)]);
  }

  /** @returns {number} the day in the middle of the visible timeline */
  centreDay() {
    const width = Math.max(this.scroller.clientWidth - this.gridWidth(), 0);
    return this.scale.dayAt(this.scroller.scrollLeft + width / 2);
  }

  /**
   * Picks the most detailed zoom that shows the range, and scrolls to it.
   * @param {string} from
   * @param {string} to
   */
  fitToRange(from, to) {
    const width = Math.max(this.scroller.clientWidth - this.gridWidth(), 200);
    const days = toDay(to) - toDay(from) + 1;
    const zoom =
      ZOOM_ORDER.find((level) => days * ZOOM_LEVELS[level].dayWidth <= width) ?? "quarter";
    this.setZoom(zoom);
    this.scrollToDate(from, { align: "start" });
  }

  /**
   * @param {string} date
   * @param {{align?: "start"|"center"}} [options]
   */
  scrollToDate(date, options = {}) {
    const scale = this.scale;
    const width = Math.max(this.scroller.clientWidth - this.gridWidth(), 0);
    const x = scale.x(toDay(date));
    this.scroller.scrollLeft = Math.max(
      0,
      options.align === "center" ? x - width / 2 : x - scale.dayWidth * 2,
    );
    this.render();
  }

  /**
   * @param {string} id
   * @param {{select?: boolean}} [options]
   */
  scrollToTask(id, options = {}) {
    if (!this.store.get("tasks", id)) return;
    this.focusTask(id, { focus: false });
    const row = this.rowById(id);
    if (row?.dates) this.scrollToDate(toISO(row.dates.start), { align: "start" });
    if (options.select) this.select([id]);
  }

  scrollToInitialPosition() {
    const target = this.options.scrollTo;
    if (target === "today") this.scrollToDate(this.todayISO(), { align: "start" });
    else if (target && target !== "start") this.scrollToDate(target, { align: "start" });
    else if (this.analysis.schedule.projectStart)
      this.scrollToDate(this.analysis.schedule.projectStart, { align: "start" });
  }

  /* -------------------------------------------------- display toggles */

  /** @param {boolean} readOnly */
  setReadOnly(readOnly) {
    if (this.readOnly === Boolean(readOnly)) return;
    this.readOnly = Boolean(readOnly);
    this.updateRootState();
    this.columnCache = null;
    this.timeline.invalidate();
    this.render();
    this.emit("readonly-change", { readOnly: this.readOnly });
  }

  /** @param {string|null} baselineId "current" for the latest, or null to hide */
  setBaselineVisible(baselineId) {
    this.baselineId = baselineId;
    this.rowCache = null;
    this.render();
    this.emit("baseline-visibility-change", { baselineId });
  }

  /** @param {boolean} visible */
  setCriticalPathVisible(visible) {
    this.showCriticalPath = Boolean(visible);
    this.updateRootState();
    this.timeline.invalidate();
    this.render();
    this.emit("critical-path-visibility-change", { visible: this.showCriticalPath });
  }

  /**
   * Shows only tasks for which the predicate is true (plus their summaries).
   * @param {((task: Readonly<Record<string, any>>) => boolean)|null} predicate
   */
  setFilter(predicate) {
    this.filter = predicate;
    this.rowCache = null;
    this.render();
    this.emit("filter-change", { active: Boolean(predicate) });
  }

  /**
   * Shows the tasks that overlap a window of `weeks` weeks from `from`
   * (default: the data date, else today), plus their summaries.
   * @param {{weeks: number, from?: string}|null} lookahead
   */
  setLookahead(lookahead) {
    if (!lookahead) {
      this.lookahead = null;
    } else {
      const from = toDay(lookahead.from ?? this.store.data.dataDate ?? this.todayISO());
      this.lookahead = { weeks: lookahead.weeks, from, to: from + lookahead.weeks * 7 - 1 };
    }
    this.rowCache = null;
    this.render();
    this.emit("lookahead-change", {
      lookahead: this.lookahead
        ? {
            weeks: this.lookahead.weeks,
            from: toISO(this.lookahead.from),
            to: toISO(this.lookahead.to),
          }
        : null,
    });
  }

  /* --------------------------------------------- keyboard edits & speech */

  /**
   * Moves a task by whole working days (Alt+arrow).
   * @param {string} id
   * @param {number} direction
   * @returns {Promise<import("../model/controller.js").EditResult>|null}
   */
  nudgeTask(id, direction) {
    const row = this.rowById(id);
    if (!this.canEditByKeyboard(row)) return null;
    const start = this.calendar.addWorkingDays(row.dates.start, direction);
    return this.updateTask(id, { start: toISO(start) }, { cause: "keyboard" }).then((result) => {
      this.announceEdit(result, id, "move");
      this.focusTask(id);
      return result;
    });
  }

  /**
   * Shortens or lengthens a task by one working day (Alt+Shift+arrow).
   * @param {string} id
   * @param {number} direction
   * @returns {Promise<import("../model/controller.js").EditResult>|null}
   */
  nudgeDuration(id, direction) {
    const row = this.rowById(id);
    if (!this.canEditByKeyboard(row) || row.milestone) return null;
    const duration = Math.max(1, row.dates.duration + direction);
    return this.updateTask(id, { duration }, { cause: "keyboard" }).then((result) => {
      this.announceEdit(result, id, "resize-end");
      this.focusTask(id);
      return result;
    });
  }

  /**
   * @param {import("./columns.js").Row|undefined} row
   * @returns {boolean}
   */
  canEditByKeyboard(row) {
    if (!row?.dates || row.summary) return false;
    if (this.readOnly) {
      this.announce(this.strings.readOnlyRefused);
      return false;
    }
    if (isLocked(row.task)) {
      this.announce(fill(this.strings.lockedRefused, { name: row.task.name }));
      return false;
    }
    return true;
  }

  /**
   * Announces the outcome of a drag or keyboard edit in the live region.
   * @param {import("../model/controller.js").EditResult} result
   * @param {string} taskId
   * @param {string} kind
   */
  announceEdit(result, taskId, kind) {
    if (!result?.committed) return;
    const task = this.getTask(taskId);
    if (!task) return;
    const long = (iso) => formatLongDate(toDay(iso), this.options.locale, { year: false });
    const others = Math.max(0, (this.lastChange?.changes.tasks.updated.length ?? 1) - 1);
    const parts = [];
    if (kind === "progress")
      parts.push(
        fill(this.strings.progressSet, {
          name: task.name,
          percent: `${Math.round(task.progress * 100)}%`,
        }),
      );
    else if (kind === "move")
      parts.push(fill(this.strings.movedTo, { name: task.name, date: long(task.start) }));
    else
      parts.push(
        fill(this.strings.resizedTo, {
          name: task.name,
          duration: task.duration,
          days: task.duration === 1 ? this.strings.workingDay : this.strings.workingDays,
          date: long(task.finish),
        }),
      );
    if (others)
      parts.push(
        others === 1
          ? this.strings.successorRescheduled
          : fill(this.strings.successorsRescheduled, { count: others }),
      );
    const finish = this.analysis.schedule.projectFinish;
    if (finish && kind !== "progress")
      parts.push(fill(this.strings.finishNow, { date: long(finish) }));
    this.announce(parts.join("; "));
  }

  /**
   * @param {import("../model/controller.js").EditResult} result
   * @param {string} fromId
   * @param {{taskId: string, type: string}} target
   */
  announceLink(result, fromId, target) {
    if (!result?.committed) return;
    this.announce(
      fill(this.strings.linkCreated, {
        from: this.getTask(fromId)?.name ?? fromId,
        to: this.getTask(target.taskId)?.name ?? target.taskId,
        type: target.type,
      }),
    );
  }

  /** @param {string} message */
  announce(message) {
    this.live.textContent = "";
    this.live.textContent = message;
  }

  undoWithAnnouncement() {
    const label = this.history.undoStack.at(-1)?.label;
    const result = this.undo();
    this.announce(result ? fill(this.strings.undone, { label }) : this.strings.nothingToUndo);
    if (this.focus.taskId && this.store.get("tasks", this.focus.taskId))
      this.focusTask(this.focus.taskId);
    return result;
  }

  redoWithAnnouncement() {
    const label = this.history.redoStack.at(-1)?.label;
    const result = this.redo();
    this.announce(result ? fill(this.strings.redone, { label }) : this.strings.nothingToRedo);
    if (this.focus.taskId && this.store.get("tasks", this.focus.taskId))
      this.focusTask(this.focus.taskId);
    return result;
  }

  /* ---------------------------------------------- editor, menu, tooltip */

  /**
   * Opens the task editor: fires the cancelable `before-editor-open`, then
   * calls a custom editor function, or the built-in dialog (see ui/editor.js).
   * @param {string} taskId
   * @returns {boolean} whether an editor opened
   */
  openEditor(taskId) {
    const task = this.getTask(taskId);
    if (!task || this.options.editor === "none") return false;
    const event = this.emit("before-editor-open", {
      taskId,
      task,
      mode: this.readOnly ? "view" : "edit",
    });
    if (!event || event.defaultPrevented) return false;
    if (typeof this.options.editor === "function") {
      this.options.editor(task, { gantt: this, readOnly: this.readOnly });
      return true;
    }
    return this.openBuiltInEditor(taskId);
  }

  /**
   * @param {string} taskId
   * @returns {boolean}
   */
  openBuiltInEditor(taskId) {
    if (this.options.editor !== "builtin" || !defaultEditor) return false;
    return defaultEditor(this, taskId);
  }

  /**
   * Fires `task-contextmenu` and opens the built-in menu (unless
   * `contextMenu: false`). Opened by right-click, long-press, Shift+F10 or the Menu key.
   * @param {string} taskId
   * @param {{clientX?: number, clientY?: number, originalEvent?: Event, keyboard?: boolean, pointerType?: string}} [context]
   * @returns {boolean} whether the built-in menu opened
   */
  openContextMenu(taskId, context = {}) {
    const task = this.getTask(taskId);
    if (!task) return false;
    this.emit("task-contextmenu", { taskId, task, originalEvent: context.originalEvent ?? null });
    this.tooltip.hide();
    const svgRect = this.timeline.svg.getBoundingClientRect();
    const overTimeline = context.clientX !== undefined && context.clientX >= svgRect.left;
    const date = overTimeline ? toISO(this.scale.dayAt(context.clientX - svgRect.left)) : null;
    return this.menu.open({ gantt: this, taskId, task, date }, context);
  }

  /**
   * Opens the "Link to…" picker (Ctrl+K).
   * @param {string} taskId
   * @returns {boolean}
   */
  openLinkPicker(taskId) {
    return openLinkPicker(this, taskId);
  }

  /**
   * Deletes a task after confirmation (Delete key and menu).
   * @param {string} taskId
   * @returns {Promise<import("../model/controller.js").EditResult|null>}
   */
  async requestRemove(taskId) {
    const task = this.getTask(taskId);
    if (!task || this.readOnly) return null;
    if (this.options.confirmDelete !== false) {
      const confirmed = await confirmDialog(this.root, {
        title: this.strings.deleteTitle,
        message: fill(this.strings.deleteMessage, { name: task.name }),
        confirm: this.strings.deleteConfirm,
        cancel: this.strings.cancel,
        danger: true,
      });
      if (!confirmed) return null;
    }
    const rows = this.rows();
    const position = rows.findIndex((row) => row.id === taskId);
    const result = await this.removeTask(taskId, { cause: "keyboard" });
    const next = this.rows()[Math.min(position, this.rows().length - 1)];
    if (next) this.focusTask(next.id);
    return result;
  }

  /**
   * Adds a task or milestone directly below another, as its next sibling.
   * @param {string} taskId
   * @param {"task"|"milestone"} kind
   * @returns {Promise<import("../model/controller.js").EditResult>}
   */
  addBelow(taskId, kind) {
    const task = this.getTask(taskId);
    const parent = task.parent ?? null;
    const siblings = this.analysis.tree.hierarchy.childrenOf.get(parent) ?? [];
    const milestone = kind === "milestone";
    const start = task.summary
      ? task.start
      : toISO(this.calendar.addWorkingDays(toDay(task.finish), milestone ? 0 : 1));
    const input = {
      name: milestone ? this.strings.newMilestone : this.strings.newTask,
      start,
      ...(milestone ? { type: "milestone", duration: 0 } : { duration: 1 }),
    };
    return this.addTask(/** @type {any} */ (input), {
      parent,
      index: siblings.indexOf(taskId) + 1,
      cause: "menu",
    }).then((result) => {
      const added = this.lastChange?.changes.tasks.added[0]?.id;
      if (result.committed && added) this.focusTask(added, { column: 1 });
      return result;
    });
  }

  /**
   * Starts inline editing of a cell (Enter or F2).
   * @param {string} taskId
   * @param {number} column
   * @returns {boolean}
   */
  startCellEdit(taskId, column) {
    if (this.timelineOnly) return this.openEditor(taskId);
    return startCellEdit(this, taskId, column);
  }

  /**
   * @param {string} taskId
   * @param {{clientX: number, clientY: number}} point
   */
  showTooltip(taskId, point) {
    this.tooltip.show(taskId, point);
  }

  hideTooltip() {
    this.tooltip.hide();
  }

  /* ------------------------------------------------------------ lifecycle */

  /**
   * Removes listeners, observers, timers and DOM. Idempotent.
   */
  destroy() {
    if (this.destroyed) return;
    super.destroy();
    if (this.frame) window.cancelAnimationFrame(this.frame);
    if (this.scrollTimer) window.clearTimeout(this.scrollTimer);
    this.frame = 0;
    this.scrollTimer = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.scroller.removeEventListener("scroll", this.onScroll);
    this.pointer.destroy();
    this.keyboard.destroy();
    this.tooltip.destroy();
    this.menu.destroy();
    this.activeDialog?.close();
    this.grid.destroy();
    this.timeline.destroy();
    this.root.remove();
  }
}
