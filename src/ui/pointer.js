// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toISO } from "../engine/dates.js";

/**
 * Pointer interaction on the timeline: clicks, hover, long-press and drag
 * editing (move, resize-start, resize-end, progress and link creation).
 *
 * - A drag starts only after the pointer moves 6 px, so clicks and scrolling
 *   are unaffected.
 * - Touch and pen drags start only on a task that is already selected (tap
 *   to select, then drag). Elsewhere the browser keeps native scrolling, and
 *   a long press opens the context menu.
 * - The pointer is captured once a drag starts, so releasing outside the
 *   window still ends it cleanly. Esc cancels.
 * - `drag-move` fires at most once per animation frame and carries the live
 *   cascade preview, so host pages can animate summaries during the drag.
 * - Every drag has a keyboard alternative (WCAG 2.5.7); see ui/keyboard.js.
 *
 * @module ui/pointer
 */

const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 500;
const EDGE_SCROLL_ZONE = 40;
const PROGRESS_STEP = 0.05;

/**
 * @typedef {object} DragState
 * @property {number} pointerId
 * @property {string} pointerType
 * @property {"move"|"resize-start"|"resize-end"|"progress"|"link"} kind
 * @property {"start"|"end"} [linkSide]
 * @property {string} taskId
 * @property {number} startX timeline x at pointerdown
 * @property {number} startY
 * @property {number} clientX
 * @property {number} clientY
 * @property {boolean} started
 * @property {{start: number, finish: number, progress: number, milestone: boolean, left: number, right: number, y: number}} origin
 * @property {any} current latest proposed dates (or link target)
 */

export class PointerController {
  /** @param {import("./gantt.js").Gantt} gantt */
  constructor(gantt) {
    this.gantt = gantt;
    this.svg = gantt.timeline.svg;
    /** @type {DragState|null} */
    this.drag = null;
    this.frame = 0;
    this.longPressTimer = 0;
    this.suppressClick = false;
    this.hoveredTaskId = null;
    this.autoScrollFrame = 0;
    this.listeners = [];
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    };
    on(this.svg, "pointerdown", (event) => this.onPointerDown(event));
    on(this.svg, "pointermove", (event) => this.onPointerMove(event));
    on(this.svg, "pointerup", (event) => this.onPointerUp(event));
    on(this.svg, "pointercancel", () => this.cancel());
    on(this.svg, "lostpointercapture", () => this.drag?.started && this.cancel());
    on(this.svg, "click", (event) => this.onClick(event));
    on(this.svg, "dblclick", (event) => this.onDoubleClick(event));
    on(this.svg, "contextmenu", (event) => this.onContextMenu(event));
    on(this.svg, "pointerover", (event) => this.onHover(event));
    on(this.svg, "pointerout", (event) => this.onHoverOut(event));
    on(this.svg, "touchstart", (event) => this.onTouchStart(event), { passive: false });
    this.onKeyDown = (event) => {
      if (event.key === "Escape" && this.drag?.started) {
        event.preventDefault();
        this.cancel();
      }
    };
  }

  /**
   * @param {PointerEvent|MouseEvent} event
   * @returns {{x: number, y: number}}
   */
  localPoint(event) {
    const rect = this.svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * @param {EventTarget|null} target
   * @returns {{taskId: string|null, handle: string|null, linkId: string|null, delayId: string|null}}
   */
  hit(target) {
    const element = target instanceof Element ? target : null;
    const handle = element?.closest("[data-handle]")?.getAttribute("data-handle") ?? null;
    const taskId = element?.closest("[data-task-id]")?.getAttribute("data-task-id") ?? null;
    const linkId = element?.closest("[data-link-id]")?.getAttribute("data-link-id") ?? null;
    const delayId = element?.closest("[data-delay-id]")?.getAttribute("data-delay-id") ?? null;
    return { taskId, handle, linkId, delayId };
  }

  /**
   * A touch that starts on a handle of the selected, editable task claims the
   * gesture for dragging (browsers do not honour `touch-action` on SVG
   * shapes consistently). Every other touch is left to native scrolling.
   * @param {TouchEvent} event
   */
  onTouchStart(event) {
    const { taskId, handle } = this.hit(event.target);
    const claimsGesture =
      Boolean(taskId && handle) && this.gantt.selection.has(taskId) && !this.gantt.readOnly;
    if (claimsGesture && event.cancelable) event.preventDefault();
  }

  /** @param {PointerEvent} event */
  onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const { taskId, handle } = this.hit(event.target);
    if (!taskId) return;
    if (event.pointerType !== "mouse") this.startLongPress(event, taskId);
    if (!handle || this.gantt.readOnly) return;
    const touchLike = event.pointerType === "touch" || event.pointerType === "pen";
    if (touchLike && !this.gantt.selection.has(taskId)) return;
    const row = this.gantt.rowById(taskId);
    if (!row?.dates) return;
    const { x, y } = this.localPoint(event);
    const geometry = this.gantt.timeline.geometry(
      row,
      this.gantt.rowPosition(taskId),
      this.gantt.frameMetrics(),
    );
    const kind = handle.startsWith("link") ? "link" : /** @type {DragState["kind"]} */ (handle);
    this.drag = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      kind,
      linkSide: handle === "link-start" ? "start" : handle === "link-end" ? "end" : undefined,
      taskId,
      startX: x,
      startY: y,
      clientX: event.clientX,
      clientY: event.clientY,
      started: false,
      origin: {
        start: row.dates.start,
        finish: row.dates.finish,
        progress: row.dates.progress,
        milestone: row.milestone,
        left: geometry.left,
        right: geometry.right,
        y: geometry.y,
      },
      current: null,
    };
    if (touchLike) event.preventDefault();
  }

  /**
   * @param {PointerEvent} event
   * @param {string} taskId
   */
  startLongPress(event, taskId) {
    this.clearLongPress();
    const { clientX, clientY } = event;
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = 0;
      if (this.drag?.started) return;
      this.drag = null;
      this.suppressClick = true;
      this.gantt.openContextMenu(taskId, { clientX, clientY, pointerType: event.pointerType });
    }, LONG_PRESS_MS);
  }

  clearLongPress() {
    if (!this.longPressTimer) return;
    window.clearTimeout(this.longPressTimer);
    this.longPressTimer = 0;
  }

  /** @param {PointerEvent} event */
  onPointerMove(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.started) {
      const distance = Math.hypot(
        event.clientX - (drag.startX + this.svg.getBoundingClientRect().left),
        event.clientY - (drag.startY + this.svg.getBoundingClientRect().top),
      );
      if (distance < DRAG_THRESHOLD) return;
      this.clearLongPress();
      this.begin(event);
    }
    event.preventDefault();
    this.requestFrame();
  }

  /** @param {PointerEvent} event */
  begin(event) {
    const drag = this.drag;
    drag.started = true;
    try {
      this.svg.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events have no active pointer to capture */
    }
    document.addEventListener("keydown", this.onKeyDown, true);
    this.gantt.root.classList.add("sg-dragging");
    this.gantt.select([drag.taskId]);
    this.gantt.emit("drag-start", {
      kind: drag.kind,
      taskId: drag.taskId,
      from: this.describeOrigin(),
      to: this.describeOrigin(),
      pointerType: drag.pointerType,
    });
    this.startAutoScroll();
  }

  requestFrame() {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  /** Computes the proposed change for the current pointer position and previews it. */
  update() {
    const drag = this.drag;
    if (!drag?.started) return;
    const rect = this.svg.getBoundingClientRect();
    const x = drag.clientX - rect.left;
    const y = drag.clientY - rect.top;
    if (drag.kind === "link") {
      this.updateLinkDraft(x, y);
      return;
    }
    drag.current = this.proposeDates(x);
    const preview = this.gantt.setPreview(drag.taskId, drag.current);
    this.gantt.emit("drag-move", {
      kind: drag.kind,
      taskId: drag.taskId,
      from: this.describeOrigin(),
      to: describe(drag.current),
      preview: [...preview].map(([id, dates]) => ({
        id,
        start: toISO(dates.start),
        finish: toISO(dates.finish),
      })),
      pointerType: drag.pointerType,
    });
  }

  /** @returns {Record<string, unknown>} */
  describeOrigin() {
    return this.describeOriginOf(/** @type {DragState} */ (this.drag));
  }

  /**
   * Snaps a pointer position to dates (or progress) for the drag kind. A move
   * keeps the grab offset and shifts by whole days; a resize takes the day
   * column under the pointer, so the reported finish is the inclusive date the
   * user can see (Frappe Gantt #73).
   * @param {number} x
   * @returns {{start: number, finish: number, progress: number}}
   */
  proposeDates(x) {
    const drag = this.drag;
    const calendar = this.gantt.calendar;
    const scale = this.gantt.scale;
    const { origin } = drag;
    const delta = Math.round((x - drag.startX) / scale.dayWidth);
    if (drag.kind === "progress") {
      const fraction = (x - origin.left) / Math.max(origin.right - origin.left, 1);
      const progress = Math.min(
        1,
        Math.max(0, Math.round(fraction / PROGRESS_STEP) * PROGRESS_STEP),
      );
      return {
        start: origin.start,
        finish: origin.finish,
        progress: Math.round(progress * 100) / 100,
      };
    }
    if (drag.kind === "resize-end") {
      const underPointer = scale.dayAt(x);
      const finish = Math.max(calendar.previousWorkingDay(underPointer), origin.start);
      return { start: origin.start, finish, progress: origin.progress };
    }
    if (drag.kind === "resize-start") {
      const underPointer = scale.dayAt(x);
      const start = Math.min(calendar.nextWorkingDay(underPointer), origin.finish);
      return { start, finish: origin.finish, progress: origin.progress };
    }
    const target = origin.start + delta;
    const start =
      delta >= 0 ? calendar.nextWorkingDay(target) : calendar.previousWorkingDay(target);
    if (origin.milestone) return { start, finish: start, progress: origin.progress };
    const duration = Math.max(calendar.workingDaysBetween(origin.start, origin.finish), 1);
    return {
      start,
      finish: calendar.addWorkingDays(start, duration - 1),
      progress: origin.progress,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  updateLinkDraft(x, y) {
    const drag = this.drag;
    const target = this.linkTarget(drag.clientX, drag.clientY, x);
    drag.current = target;
    const originX = drag.linkSide === "start" ? drag.origin.left : drag.origin.right;
    this.gantt.timeline.drawLinkDraft({
      x1: originX,
      y1: drag.origin.y,
      x2: x,
      y2: y,
      valid: Boolean(target?.valid),
    });
    this.gantt.emit("drag-move", {
      kind: "link",
      taskId: drag.taskId,
      from: { taskId: drag.taskId, side: drag.linkSide },
      to: target,
      preview: [],
      pointerType: drag.pointerType,
    });
  }

  /**
   * The task and side under the pointer while creating a link.
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} x
   * @returns {{taskId: string, type: string, valid: boolean}|null}
   */
  linkTarget(clientX, clientY, x) {
    const element = document.elementFromPoint(clientX, clientY);
    const taskId =
      element && this.svg.contains(element)
        ? element.closest("[data-task-id]")?.getAttribute("data-task-id")
        : null;
    if (!taskId || taskId === this.drag.taskId) return null;
    const row = this.gantt.rowById(taskId);
    if (!row?.dates || row.summary) return null;
    const geometry = this.gantt.timeline.geometry(
      row,
      this.gantt.rowPosition(taskId),
      this.gantt.frameMetrics(),
    );
    const targetSide = x < (geometry.left + geometry.right) / 2 ? "start" : "end";
    const type = `${this.drag.linkSide === "start" ? "S" : "F"}${targetSide === "start" ? "S" : "F"}`;
    return { taskId, type, valid: this.gantt.canLink(this.drag.taskId, taskId) };
  }

  /** @param {PointerEvent} event */
  onPointerUp(event) {
    const drag = this.drag;
    this.clearLongPress();
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      this.drag = null;
      return;
    }
    if (this.frame) {
      window.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.update();
    this.finish(false);
  }

  /** Cancels the active drag (Esc, pointercancel, lost capture or destroy). */
  cancel() {
    this.clearLongPress();
    if (!this.drag) return;
    if (!this.drag.started) {
      this.drag = null;
      return;
    }
    this.finish(true);
  }

  /** @param {boolean} cancelled */
  finish(cancelled) {
    const drag = this.drag;
    this.drag = null;
    this.stopAutoScroll();
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.gantt.root.classList.remove("sg-dragging");
    this.gantt.timeline.drawLinkDraft(null);
    this.gantt.clearPreview();
    this.suppressClick = true;
    const to =
      drag.kind === "link"
        ? drag.current
        : drag.current
          ? describe(drag.current)
          : this.describeOriginOf(drag);
    this.gantt.emit("drag-end", {
      kind: drag.kind,
      taskId: drag.taskId,
      from:
        drag.kind === "link"
          ? { taskId: drag.taskId, side: drag.linkSide }
          : this.describeOriginOf(drag),
      to,
      cancelled,
      pointerType: drag.pointerType,
    });
    if (cancelled || !drag.current) {
      this.gantt.render();
      return;
    }
    this.commit(drag);
  }

  /**
   * @param {DragState} drag
   * @returns {Record<string, unknown>}
   */
  describeOriginOf(drag) {
    return describe({
      start: drag.origin.start,
      finish: drag.origin.finish,
      progress: drag.origin.progress,
    });
  }

  /** @param {DragState} drag */
  commit(drag) {
    const gantt = this.gantt;
    if (drag.kind === "link") {
      const target = drag.current;
      if (!target?.taskId) return;
      gantt
        .addLink({ from: drag.taskId, to: target.taskId, type: target.type }, { cause: "drag" })
        .then((result) => gantt.announceLink(result, drag.taskId, target));
      return;
    }
    const { start, finish, progress } = drag.current;
    const { origin } = drag;
    if (drag.kind === "progress") {
      if (progress !== origin.progress)
        gantt
          .updateTask(drag.taskId, { progress }, { cause: "drag" })
          .then((result) => gantt.announceEdit(result, drag.taskId, "progress"));
      return;
    }
    if (start === origin.start && finish === origin.finish) {
      gantt.render();
      return;
    }
    const patch =
      drag.kind === "move"
        ? { start: toISO(start) }
        : drag.kind === "resize-start"
          ? { start: toISO(start), finish: toISO(finish) }
          : { finish: toISO(finish) };
    gantt
      .updateTask(drag.taskId, patch, { cause: "drag" })
      .then((result) => gantt.announceEdit(result, drag.taskId, drag.kind));
  }

  startAutoScroll() {
    const step = () => {
      this.autoScrollFrame = 0;
      const drag = this.drag;
      if (!drag?.started) return;
      const scroller = this.gantt.scroller;
      const rect = scroller.getBoundingClientRect();
      const gridEdge = rect.left + this.gantt.gridWidth();
      let dx = 0;
      if (drag.clientX > rect.right - EDGE_SCROLL_ZONE) dx = 12;
      else if (drag.clientX < gridEdge + EDGE_SCROLL_ZONE && drag.clientX >= rect.left) dx = -12;
      const outsideWindow = drag.clientX < 0 || drag.clientX > window.innerWidth;
      if (dx && !outsideWindow) {
        scroller.scrollLeft += dx;
        this.requestFrame();
      }
      this.autoScrollFrame = window.requestAnimationFrame(step);
    };
    this.autoScrollFrame = window.requestAnimationFrame(step);
  }

  stopAutoScroll() {
    if (!this.autoScrollFrame) return;
    window.cancelAnimationFrame(this.autoScrollFrame);
    this.autoScrollFrame = 0;
  }

  /** @param {MouseEvent} event */
  onClick(event) {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const { taskId, linkId, delayId } = this.hit(event.target);
    const gantt = this.gantt;
    if (taskId) {
      gantt.select([taskId], { additive: event.ctrlKey || event.metaKey });
      gantt.focusTask(taskId, { scroll: false, focus: gantt.timelineOnly });
      const task = gantt.getTask(taskId);
      gantt.emit("task-click", { taskId, task, originalEvent: event });
      if (gantt.rowById(taskId)?.milestone)
        gantt.emit("milestone-click", { taskId, task, originalEvent: event });
      return;
    }
    if (linkId) {
      gantt.selectLink(linkId);
      gantt.emit("link-click", { linkId, link: gantt.getLink(linkId), originalEvent: event });
      return;
    }
    if (delayId) {
      gantt.emit("delay-click", {
        delayId,
        delay: gantt.store.get("delayEvents", delayId),
        originalEvent: event,
      });
      return;
    }
    const { x, y } = this.localPoint(event);
    const row = gantt.rowAtY(y);
    gantt.emit("cell-click", {
      date: toISO(gantt.scale.dayAt(x)),
      rowTaskId: row?.id ?? null,
      originalEvent: event,
    });
  }

  /** @param {MouseEvent} event */
  onDoubleClick(event) {
    const { taskId, linkId } = this.hit(event.target);
    if (taskId) {
      const ev = this.gantt.emit("task-dblclick", {
        taskId,
        task: this.gantt.getTask(taskId),
        originalEvent: event,
      });
      if (ev) this.gantt.openEditor(taskId);
      return;
    }
    if (linkId)
      this.gantt.emit("link-dblclick", {
        linkId,
        link: this.gantt.getLink(linkId),
        originalEvent: event,
      });
  }

  /** @param {MouseEvent} event */
  onContextMenu(event) {
    const { taskId } = this.hit(event.target);
    if (!taskId) return;
    this.clearLongPress();
    const opened = this.gantt.openContextMenu(taskId, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: "mouse",
      originalEvent: event,
    });
    if (opened) event.preventDefault();
  }

  /** @param {PointerEvent} event */
  onHover(event) {
    const { taskId } = this.hit(event.target);
    if (!taskId || taskId === this.hoveredTaskId) return;
    if (this.hoveredTaskId)
      this.gantt.emit("task-hover-end", {
        taskId: this.hoveredTaskId,
        task: this.gantt.getTask(this.hoveredTaskId),
      });
    this.hoveredTaskId = taskId;
    this.gantt.emit("task-hover-start", { taskId, task: this.gantt.getTask(taskId) });
    this.gantt.showTooltip(taskId, event);
  }

  /** @param {PointerEvent} event */
  onHoverOut(event) {
    if (!this.hoveredTaskId) return;
    const next =
      event.relatedTarget instanceof Element
        ? event.relatedTarget.closest("[data-task-id]")?.getAttribute("data-task-id")
        : null;
    if (next === this.hoveredTaskId) return;
    const taskId = this.hoveredTaskId;
    this.hoveredTaskId = null;
    this.gantt.emit("task-hover-end", { taskId, task: this.gantt.getTask(taskId) });
    this.gantt.hideTooltip();
  }

  /** @returns {boolean} */
  get dragging() {
    return Boolean(this.drag?.started);
  }

  destroy() {
    this.cancel();
    this.clearLongPress();
    this.stopAutoScroll();
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    document.removeEventListener("keydown", this.onKeyDown, true);
    for (const remove of this.listeners) remove();
    this.listeners = [];
  }
}

/**
 * @param {{start: number, finish: number, progress?: number}} dates
 * @returns {{start: string, finish: string, progress: number}}
 */
function describe(dates) {
  return { start: toISO(dates.start), finish: toISO(dates.finish), progress: dates.progress ?? 0 };
}
