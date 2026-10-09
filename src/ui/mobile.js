// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toDay } from "../engine/dates.js";
import { formatDate } from "../engine/format.js";
import { html, svg } from "./dom.js";
import { ZOOM_LEVELS, ZOOM_ORDER } from "./scale.js";
import { fill } from "./strings.js";

/**
 * The phone experience (`streamlined-gantt/mobile`, ADR-0011).
 *
 * - **Preview**: below `breakpoint` (a phone held upright) the chart is
 *   replaced by a readable list, one row per task with its dates and a mini
 *   bar on a shared track, and a button that opens the full chart. The list
 *   has no inner scroll; the page scrolls.
 * - **Full screen**: `open()` moves the chart into a modal `<dialog>` inside
 *   the host (so the host's theme selectors still match), which gives the top
 *   layer, a focus trap and Escape for free. On touch devices it also asks
 *   for document fullscreen and a landscape lock where the browser allows it
 *   (Android Chrome); iPhones, which have neither, get the same full-viewport
 *   dialog. Rows shrink, down to `minRowHeight`, so the whole programme fits
 *   the height; a rail holds close, zoom and fit controls, and pinch zooms.
 * - **Inline**: at other widths the chart is unchanged, with an expand button.
 *
 * Events: `layout-change` and `fullscreen-change` on the chart (DOM
 * `gantt:layout-change`, `gantt:fullscreen-change` on the host).
 *
 * @module ui/mobile
 */

/** Every string the mobile view shows; override through `strings` (here or on the chart). */
export const MOBILE_STRINGS = {
  mobileOpen: "Open the chart",
  mobileOpenTask: "{name}, {dates}. Open on the chart",
  mobileHint: "Opens full screen. Turn your phone sideways for the most room.",
  mobileRange: "{start} to {finish}",
  mobilePreviewLabel: "Programme summary",
  mobileDialogLabel: "Programme chart",
  mobileRail: "Chart controls",
  mobileClose: "Close the chart",
  mobileExpand: "Open the chart full screen",
  mobileZoomIn: "Zoom in",
  mobileZoomOut: "Zoom out",
  mobileFit: "Fit the whole programme",
  mobileRotate: "Turn your phone sideways for a wider chart.",
  mobileDays: "{count} days",
  mobileDay: "1 day",
};

/**
 * @typedef {object} MobileOptions
 * @property {number} [breakpoint] host width in px below which the preview replaces the chart (600)
 * @property {boolean} [preview] show the preview below the breakpoint (true); false keeps the chart
 * @property {boolean} [expandButton] draw the expand button on the inline chart (true)
 * @property {"auto"|"always"|"never"} [fullscreen] use the Fullscreen API: on touch devices ("auto"), everywhere, or never
 * @property {"landscape"|"any"} [orientation] lock to landscape while full screen, where supported ("landscape")
 * @property {number} [minRowHeight] smallest row when fitting rows to the screen (24, the WCAG 2.5.8 target size)
 * @property {number} [maxRowHeight] largest row when fitting rows to the screen (44)
 * @property {boolean} [pinchZoom] pinch to zoom in the full-screen chart (true)
 * @property {Partial<typeof MOBILE_STRINGS>} [strings]
 */

const ICONS = {
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  close: "M6 6l12 12M18 6L6 18",
  in: "M12 5v14M5 12h14",
  out: "M5 12h14",
  fit: "M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4",
};

/**
 * @param {keyof typeof ICONS} name
 * @returns {SVGElement}
 */
function icon(name) {
  return svg("svg", { class: "sg-icon", viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svg("path", { d: ICONS[name] }),
  ]);
}

/**
 * The mobile controller for one chart. Create it with {@link mobileView}.
 */
export class MobileView {
  /**
   * @param {import("./gantt.js").Gantt} gantt
   * @param {MobileOptions} [options]
   */
  constructor(gantt, options = {}) {
    this.gantt = gantt;
    this.options = {
      breakpoint: 600,
      preview: true,
      expandButton: true,
      fullscreen: "auto",
      orientation: "landscape",
      minRowHeight: 24,
      maxRowHeight: 44,
      pinchZoom: true,
      ...options,
    };
    this.strings = {
      ...MOBILE_STRINGS,
      ...(gantt.options.strings ?? {}),
      ...(options.strings ?? {}),
    };
    /** @type {"inline"|"preview"|"fullscreen"} */
    this.mode = "inline";
    this.isOpen = false;
    this.native = false;
    this.width = 0;
    this.previewDirty = true;
    /** @type {HTMLElement|null} */
    this.returnFocus = null;
    /** @type {(() => void)[]} */
    this.cleanups = [];
    this.build();
    this.listen();
    this.update();
  }

  /* ---------------------------------------------------------------- DOM */

  build() {
    const s = this.strings;
    const gantt = this.gantt;
    this.preview = html("section", {
      class: "sg-root sg-preview",
      "aria-label": s.mobilePreviewLabel,
      hidden: true,
    });
    this.range = html("p", { class: "sg-preview-range" });
    this.cta = html("button", { type: "button", class: "sg-button sg-cta" }, [s.mobileOpen]);
    this.list = html("ol", { class: "sg-preview-list" });
    this.preview.append(
      html("div", { class: "sg-preview-head" }, [
        this.range,
        this.cta,
        html("p", { class: "sg-preview-hint" }, [s.mobileHint]),
      ]),
      this.list,
    );
    gantt.root.before(this.preview);
    this.expand = this.options.expandButton
      ? html(
          "button",
          { type: "button", class: "sg-button sg-expand", "aria-label": s.mobileExpand },
          [icon("expand")],
        )
      : null;
    if (this.expand) gantt.root.append(this.expand);
    this.sheet = /** @type {HTMLDialogElement} */ (
      html("dialog", { class: "sg-sheet", "aria-label": s.mobileDialogLabel })
    );
    gantt.root.after(this.sheet);
    const button = (name, label) =>
      /** @type {HTMLButtonElement} */ (
        html("button", { type: "button", class: "sg-button", "aria-label": label }, [icon(name)])
      );
    this.closeButton = button("close", s.mobileClose);
    this.zoomInButton = button("in", s.mobileZoomIn);
    this.zoomOutButton = button("out", s.mobileZoomOut);
    this.fitButton = button("fit", s.mobileFit);
    this.rail = html("div", { class: "sg-rail", role: "toolbar", "aria-label": s.mobileRail }, [
      this.closeButton,
      this.zoomInButton,
      this.zoomOutButton,
      this.fitButton,
      html("p", { class: "sg-rotate-hint" }, [s.mobileRotate]),
    ]);
  }

  /**
   * @param {EventTarget} target
   * @param {string} type
   * @param {(event: any) => void} handler
   * @param {AddEventListenerOptions} [options]
   */
  on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  listen() {
    const gantt = this.gantt;
    this.on(this.cta, "click", () => this.open());
    if (this.expand) this.on(this.expand, "click", () => this.open());
    this.on(this.list, "click", (event) => {
      const id = event.target.closest?.("[data-task-id]")?.getAttribute("data-task-id");
      if (id) this.open({ taskId: id });
    });
    this.on(this.closeButton, "click", () => this.close());
    this.on(this.zoomInButton, "click", () => this.zoom(-1));
    this.on(this.zoomOutButton, "click", () => this.zoom(1));
    this.on(this.fitButton, "click", () => this.fit());
    this.on(this.sheet, "cancel", (event) => {
      event.preventDefault();
      this.close();
    });
    this.on(document, "fullscreenchange", () => this.onFullscreenChange());
    this.on(gantt.scroller, "touchstart", (event) => this.onTouchStart(event), { passive: true });
    this.on(gantt.scroller, "touchmove", (event) => this.onTouchMove(event), { passive: false });
    for (const name of ["change", "load"])
      this.cleanups.push(
        gantt.on(name, () => {
          this.previewDirty = true;
          if (this.mode === "preview") this.renderPreview();
          if (this.isOpen) this.fitRows();
        }),
      );
    this.cleanups.push(gantt.on("zoom-change", () => this.updateRail()));
    this.cleanups.push(gantt.on("destroy", () => this.destroy()));
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.update());
      this.resizeObserver.observe(this.preview);
      this.resizeObserver.observe(gantt.root);
    }
    if (typeof matchMedia === "function") {
      this.portraitQuery = matchMedia("(orientation: portrait)");
      this.on(this.portraitQuery, "change", () => this.update());
    }
  }

  /* -------------------------------------------------------------- state */

  /** @returns {"portrait"|"landscape"} */
  get orientation() {
    return this.portraitQuery?.matches ? "portrait" : "landscape";
  }

  /**
   * Re-measures and switches between the inline chart and the preview, and
   * refits the rows while full screen. Runs on resize and orientation change.
   */
  update() {
    if (this.destroyed) return;
    if (this.isOpen) {
      this.fitRows();
      return;
    }
    const visible = this.mode === "preview" ? this.preview : this.gantt.root;
    const width = visible.getBoundingClientRect().width;
    if (width > 0) this.width = width;
    const compact = this.options.preview && this.width > 0 && this.width < this.options.breakpoint;
    this.setMode(compact ? "preview" : "inline");
  }

  /** @param {"inline"|"preview"|"fullscreen"} mode */
  setMode(mode) {
    const previous = this.mode;
    if (mode !== "fullscreen") {
      this.preview.hidden = mode !== "preview";
      this.gantt.root.hidden = mode === "preview";
    }
    if (mode === "preview" && this.previewDirty) this.renderPreview();
    if (mode === previous) return;
    this.mode = mode;
    if (mode === "inline") this.gantt.requestRender();
    this.gantt.emit("layout-change", {
      mode,
      previous,
      orientation: this.orientation,
      width: this.width,
    });
  }

  /* ------------------------------------------------------------ preview */

  renderPreview() {
    this.previewDirty = false;
    const gantt = this.gantt;
    const s = this.strings;
    const locale = gantt.options.locale;
    const short = (day) => formatDate(day, locale, { day: "numeric", month: "short" });
    const long = (day) =>
      formatDate(day, locale, { day: "numeric", month: "short", year: "numeric" });
    this.preview.className = [
      "sg-root sg-preview",
      ...[...gantt.root.classList].filter((name) => /^sg-(scheme-|show-critical)/.test(name)),
    ].join(" ");
    for (const property of gantt.root.style)
      if (property.startsWith("--sg-") && property !== "--sg-height")
        this.preview.style.setProperty(property, gantt.root.style.getPropertyValue(property));
    const schedule = gantt.analysis.schedule;
    const first = schedule.projectStart ? toDay(schedule.projectStart) : null;
    const last = schedule.projectFinish ? toDay(schedule.projectFinish) : null;
    this.range.textContent =
      first === null ? "" : fill(s.mobileRange, { start: long(first), finish: long(last) });
    const span = first === null ? 1 : last - first + 1;
    const items = gantt.rows().map((row) => {
      const state = gantt.taskState(row);
      const appearance = gantt.appearanceOf(row.task);
      const dates = row.dates;
      const days = dates?.duration ?? 0;
      const text = !dates
        ? ""
        : row.milestone
          ? short(dates.start)
          : `${short(dates.start)} – ${short(dates.finish)} · ${days === 1 ? s.mobileDay : fill(s.mobileDays, { count: days })}`;
      const name = gantt.timeline.labelFor(row) || row.task.name;
      const bar = html("span", { class: "sg-preview-bar" });
      if (dates && first !== null) {
        const anchor = row.milestone && gantt.isFinishAnchored(row.id) ? 1 : 0;
        const percent = ((dates.start + anchor - first) / span) * 100;
        bar.style.left = row.milestone
          ? `clamp(5px, ${percent}%, calc(100% - 5px))`
          : `${percent}%`;
        if (!row.milestone) bar.style.width = `${((dates.finish - dates.start + 1) / span) * 100}%`;
      }
      const classes = [
        ...state.classes.filter((name) => !name.startsWith("sg-type-")),
        `sg-preview-${row.summary ? "summary" : (row.task.type ?? "task")}`,
        ...appearance.classes,
      ];
      const item = html("li", { class: classes.join(" ") }, [
        html(
          "button",
          {
            type: "button",
            class: "sg-preview-task",
            "data-task-id": row.id,
            "aria-label": fill(s.mobileOpenTask, { name, dates: text }),
          },
          [
            html("span", { class: "sg-preview-name" }, [name]),
            html("span", { class: "sg-preview-dates" }, [text]),
            html("span", { class: "sg-preview-track", "aria-hidden": "true" }, [bar]),
          ],
        ),
      ]);
      item.style.setProperty("--sg-level", String(row.level));
      for (const [property, value] of Object.entries(appearance.style))
        item.style.setProperty(property, value);
      return item;
    });
    this.list.replaceChildren(...items);
  }

  /* --------------------------------------------------------- full screen */

  /**
   * Opens the full-screen chart. Call it from a click or tap so the browser
   * allows fullscreen and the orientation lock. The dialog is shown after the
   * fullscreen request settles, so it stacks above the fullscreen element in
   * the top layer.
   * @param {{taskId?: string}} [options] select and scroll to a task
   * @returns {Promise<void>} resolves once the chart is showing
   */
  open(options = {}) {
    if (this.isOpen || this.destroyed) return Promise.resolve();
    const gantt = this.gantt;
    const root = gantt.root;
    this.returnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
    this.saved = {
      rowHeight: gantt.options.rowHeight,
      height: root.style.getPropertyValue("--sg-height"),
      overflow: document.documentElement.style.overflow,
      fitWidth: gantt.fitWidth,
    };
    this.isOpen = true;
    root.hidden = false;
    root.classList.add("sg-fullscreen");
    root.style.setProperty("--sg-height", "100%");
    root.append(this.rail);
    this.sheet.append(root);
    return this.requestNativeFullscreen().then(() => this.show(options.taskId));
  }

  /** @param {string|undefined} taskId */
  show(taskId) {
    if (!this.isOpen || this.sheet.open) return;
    const gantt = this.gantt;
    this.sheet.showModal();
    document.documentElement.style.overflow = "hidden";
    this.fitRows(true);
    if (taskId && gantt.getTask(taskId)) {
      gantt.select([taskId]);
      gantt.scrollToTask(taskId);
    }
    this.updateRail();
    this.closeButton.focus();
    this.setMode("fullscreen");
    this.emitFullscreen();
  }

  /** Closes the full-screen chart and puts it back in the page. */
  close() {
    if (!this.isOpen) return;
    const gantt = this.gantt;
    const root = gantt.root;
    const saved = this.saved;
    gantt.pointer?.cancel();
    this.isOpen = false;
    this.exitNativeFullscreen();
    this.rail.remove();
    root.classList.remove("sg-fullscreen");
    if (saved.height) root.style.setProperty("--sg-height", saved.height);
    else root.style.removeProperty("--sg-height");
    gantt.options.rowHeight = saved.rowHeight;
    this.sheet.after(root);
    this.sheet.close();
    document.documentElement.style.overflow = saved.overflow;
    if (saved.fitWidth && !gantt.fitWidth) gantt.setFit("width");
    else gantt.refresh();
    this.update();
    const previous = this.returnFocus;
    const target =
      previous &&
      previous !== document.body &&
      previous.isConnected &&
      !previous.closest("[hidden]");
    (target ? this.returnFocus : this.preview.hidden ? this.expand : this.cta)?.focus({
      preventScroll: true,
    });
    this.emitFullscreen();
  }

  /** @returns {boolean} whether the full-screen chart is open */
  get opened() {
    return this.isOpen;
  }

  /**
   * Asks for document fullscreen and a landscape lock where wanted and
   * supported. Never rejects: iPhones and desktops simply get the dialog.
   * @returns {Promise<void>}
   */
  requestNativeFullscreen() {
    const setting = this.options.fullscreen;
    const wanted = setting === "always" || (setting === "auto" && this.gantt.coarsePointer());
    const element = document.documentElement;
    if (!wanted || !element.requestFullscreen || document.fullscreenElement)
      return Promise.resolve();
    return element
      .requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        if (this.options.orientation === "landscape")
          /** @type {any} */ (screen.orientation)?.lock?.("landscape").catch(() => {});
      })
      .catch(() => {});
  }

  exitNativeFullscreen() {
    try {
      /** @type {any} */ (screen.orientation)?.unlock?.();
    } catch {
      /* not locked, or unsupported */
    }
    if (document.fullscreenElement === document.documentElement)
      document.exitFullscreen?.().catch(() => {});
  }

  onFullscreenChange() {
    const native = Boolean(document.fullscreenElement) && this.isOpen;
    if (native === this.native) return;
    this.native = native;
    if (this.isOpen) this.emitFullscreen();
  }

  emitFullscreen() {
    this.native = this.isOpen && Boolean(document.fullscreenElement);
    this.gantt.emit("fullscreen-change", {
      open: this.isOpen,
      native: this.native,
      orientation: this.orientation,
    });
  }

  /**
   * Sizes rows so every row fits the full-screen height, between
   * `minRowHeight` and `maxRowHeight`.
   * @param {boolean} [force] re-render even when the row height is unchanged
   */
  fitRows(force = false) {
    const gantt = this.gantt;
    const count = Math.max(gantt.rows().length, 1);
    const available = gantt.scroller.clientHeight - gantt.headerHeight;
    const { minRowHeight, maxRowHeight } = this.options;
    const height =
      available > 0
        ? Math.max(minRowHeight, Math.min(maxRowHeight, Math.floor(available / count)))
        : gantt.rowHeight;
    if (height === gantt.options.rowHeight && !force) return;
    gantt.options.rowHeight = height;
    gantt.refresh();
  }

  /* --------------------------------------------------------------- zoom */

  /**
   * One zoom step finer (-1) or coarser (+1). Zooming out past the level that
   * fits the width switches to fit-to-width.
   * @param {number} direction
   */
  zoom(direction) {
    const gantt = this.gantt;
    const dayWidth = gantt.scale.dayWidth;
    const fitted = this.fittedDayWidth();
    const levels = ZOOM_ORDER.filter((level) =>
      direction < 0
        ? ZOOM_LEVELS[level].dayWidth > dayWidth * 1.05
        : ZOOM_LEVELS[level].dayWidth < dayWidth / 1.05,
    );
    const next = direction < 0 ? levels.at(-1) : levels[0];
    if (direction < 0 && !next) return;
    if (!next || (direction > 0 && ZOOM_LEVELS[next].dayWidth <= fitted)) this.fit();
    else gantt.setZoom(next);
    this.updateRail();
  }

  fit() {
    if (!this.gantt.fitWidth) this.gantt.setFit("width");
    this.updateRail();
  }

  /** @returns {number} the day width that would fit the programme into the width */
  fittedDayWidth() {
    const gantt = this.gantt;
    const schedule = gantt.analysis.schedule;
    if (!schedule.projectStart) return 0;
    const days = toDay(schedule.projectFinish) - toDay(schedule.projectStart) + 1;
    return (gantt.scroller.clientWidth - gantt.gridWidth()) / (days * 1.04);
  }

  updateRail() {
    const gantt = this.gantt;
    this.zoomInButton.disabled = gantt.scale.dayWidth >= ZOOM_LEVELS.day.dayWidth;
    this.zoomOutButton.disabled = gantt.fitWidth;
    this.fitButton.setAttribute("aria-pressed", String(gantt.fitWidth));
  }

  /** @param {TouchEvent} event */
  onTouchStart(event) {
    this.pinch =
      this.isOpen && this.options.pinchZoom && event.touches.length === 2
        ? { distance: touchDistance(event.touches) }
        : null;
  }

  /** @param {TouchEvent} event */
  onTouchMove(event) {
    if (!this.pinch || event.touches.length !== 2) return;
    if (event.cancelable) event.preventDefault();
    const ratio = touchDistance(event.touches) / this.pinch.distance;
    if (ratio > 1.3 || ratio < 0.77) {
      this.zoom(ratio > 1 ? -1 : 1);
      this.pinch.distance = touchDistance(event.touches);
    }
  }

  /* ------------------------------------------------------------ lifecycle */

  /**
   * Closes the full-screen chart (restoring the chart's row height, height and
   * fit), then removes the summary, the expand button and every listener.
   * Idempotent; `gantt.destroy()` calls it while the chart is still intact.
   */
  destroy() {
    if (this.destroyed) return;
    this.close();
    this.destroyed = true;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.resizeObserver?.disconnect();
    this.preview.remove();
    this.sheet.remove();
    this.expand?.remove();
    this.gantt.root.hidden = false;
    if (/** @type {any} */ (this.gantt).mobile === this)
      delete (/** @type {any} */ (this.gantt).mobile);
  }
}

/**
 * @param {TouchList} touches
 * @returns {number}
 */
function touchDistance(touches) {
  return (
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY) ||
    1
  );
}

/**
 * Adds the phone experience to a chart. The handle is also `gantt.mobile`.
 * @param {import("./gantt.js").Gantt} gantt
 * @param {MobileOptions} [options]
 * @returns {MobileView}
 */
export function mobileView(gantt, options) {
  const existing = /** @type {any} */ (gantt).mobile;
  if (existing instanceof MobileView) return existing;
  const view = new MobileView(gantt, options);
  /** @type {any} */ (gantt).mobile = view;
  return view;
}

/**
 * Makes `mobile: true` (or `mobile: {…options}`, or the element's `mobile`
 * attribute) work for every chart created afterwards. The script-tag add-on
 * calls this for you.
 * @param {{extensions: ((gantt: any) => void)[]}} GanttClass the `Gantt` class
 */
export function installMobile(GanttClass) {
  if (GanttClass.extensions.includes(extendWithMobile)) return;
  GanttClass.extensions.push(extendWithMobile);
}

/** @param {any} gantt */
function extendWithMobile(gantt) {
  const setting = gantt.options.mobile;
  if (setting === undefined || setting === null || setting === false || setting === "false") return;
  mobileView(gantt, typeof setting === "object" ? setting : {});
}
