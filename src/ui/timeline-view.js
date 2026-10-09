// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toDay } from "../engine/dates.js";
import { formatMoney } from "../engine/format.js";
import { html, px, setAttributes, svg } from "./dom.js";
import { linkPath } from "./link-path.js";

/**
 * The right-hand timeline: a DOM header (two tiers plus marker flags) and one
 * SVG for the body. Bars, milestones, links, markers and bands are SVG
 * elements styled through CSS custom properties.
 *
 * The SVG spans the whole body so element positions do not change while
 * scrolling; only rows in the visible window (plus overscan) are drawn, and
 * task groups are keyed by id and rebuilt only when their content changes.
 * Non-working shading and header ticks are drawn for the visible date range
 * plus a buffer.
 *
 * @module ui/timeline-view
 */

/**
 * @typedef {object} Geometry
 * @property {number} left
 * @property {number} right
 * @property {number} y vertical centre
 * @property {number} top bar top
 * @property {number} height bar height
 * @property {boolean} point milestone-like
 */

/**
 * @typedef {object} TimelineFrame
 * @property {import("./columns.js").Row[]} rows
 * @property {number} first
 * @property {number} last
 * @property {import("./scale.js").TimeScale} scale
 * @property {number} rowHeight
 * @property {number} xFrom visible window start, timeline pixels
 * @property {number} xTo
 * @property {Map<string, number>} rowIndex row position of every visible task
 */

export class TimelineView {
  /** @param {import("./gantt.js").Gantt} gantt */
  constructor(gantt) {
    this.gantt = gantt;
    this.element = html("div", { class: "sg-timeline" });
    this.scaleElement = html("div", { class: "sg-scale", "aria-hidden": "true" });
    this.scaleTop = html("div", { class: "sg-scale-tier sg-scale-top" });
    this.scaleBottom = html("div", { class: "sg-scale-tier sg-scale-bottom" });
    this.scaleMarkers = html("div", { class: "sg-scale-markers" });
    this.scaleElement.append(this.scaleTop, this.scaleBottom, this.scaleMarkers);
    this.body = html("div", { class: "sg-timeline-body" });
    this.svg = svg("svg", { class: "sg-svg", "aria-hidden": "true", focusable: "false" });
    this.defs = svg("defs");
    this.layers = {
      background: svg("g", { class: "sg-layer-background" }),
      markers: svg("g", { class: "sg-layer-markers" }),
      delays: svg("g", { class: "sg-layer-delays" }),
      baselines: svg("g", { class: "sg-layer-baselines" }),
      links: svg("g", { class: "sg-layer-links" }),
      tasks: svg("g", { class: "sg-layer-tasks" }),
      overlay: svg("g", { class: "sg-layer-overlay" }),
    };
    this.svg.append(this.defs, ...Object.values(this.layers));
    this.body.append(this.svg);
    this.element.append(this.scaleElement, this.body);
    this.buildDefs();
    /** @type {Map<string, {element: SVGElement, signature: string}>} */
    this.tasks = new Map();
    this.backgroundSignature = "";
    this.scaleSignature = "";
  }

  buildDefs() {
    const id = this.gantt.uid;
    this.arrowId = `${id}-arrow`;
    this.hatchId = `${id}-hatch`;
    this.criticalId = `${id}-critical`;
    this.defs.append(
      svg(
        "marker",
        {
          id: this.arrowId,
          class: "sg-arrow",
          viewBox: "0 0 8 8",
          refX: 7,
          refY: 4,
          markerWidth: 7,
          markerHeight: 7,
          orient: "auto-start-reverse",
        },
        [svg("path", { d: "M0 0 L8 4 L0 8 z" })],
      ),
      svg(
        "pattern",
        {
          id: this.hatchId,
          class: "sg-hatch",
          width: 6,
          height: 6,
          patternUnits: "userSpaceOnUse",
          patternTransform: "rotate(45)",
        },
        [svg("rect", { width: 2, height: 6 })],
      ),
      svg(
        "pattern",
        {
          id: this.criticalId,
          class: "sg-critical-pattern",
          width: 8,
          height: 8,
          patternUnits: "userSpaceOnUse",
          patternTransform: "rotate(-45)",
        },
        [svg("rect", { width: 3, height: 8 })],
      ),
    );
  }

  /** @param {TimelineFrame} frame */
  render(frame) {
    const { scale, rows, rowHeight } = frame;
    const height = rows.length * rowHeight;
    this.element.style.setProperty("width", `${scale.width}px`);
    this.body.style.setProperty("height", `${height}px`);
    setAttributes(this.svg, { width: px(scale.width), height: Math.max(height, 1) });
    this.renderScale(frame);
    this.renderBackground(frame);
    this.renderMarkers(frame);
    this.renderDelays(frame);
    this.renderBaselines(frame);
    this.renderTasks(frame);
    this.renderLinks(frame);
  }

  /**
   * Pixel window rounded out to 1,024 px chunks, so background and header
   * work is redone only when the visible range crosses a chunk.
   * @param {TimelineFrame} frame
   * @returns {[number, number]}
   */
  chunk(frame) {
    const size = 1024;
    return [
      Math.max(0, Math.floor(frame.xFrom / size) * size - size),
      Math.ceil(frame.xTo / size) * size + size,
    ];
  }

  /** @param {TimelineFrame} frame */
  renderScale(frame) {
    const { scale } = frame;
    const [from, to] = this.chunk(frame);
    const signature = `${scale.zoom}|${scale.start}|${scale.end}|${from}|${to}|${this.gantt.markerSignature()}`;
    if (signature === this.scaleSignature) return;
    this.scaleSignature = signature;
    const tick = (entry) => {
      const element = html("div", { class: "sg-tick", title: entry.title }, [entry.label]);
      element.style.setProperty("left", `${px(entry.x)}px`);
      element.style.setProperty("width", `${px(entry.width)}px`);
      return element;
    };
    this.scaleTop.replaceChildren(...scale.ticks("top", from, to).map(tick));
    this.scaleBottom.replaceChildren(...scale.ticks("bottom", from, to).map(tick));
    this.scaleMarkers.replaceChildren(
      ...this.gantt.markerLines(scale).map((marker) => {
        const flag = html(
          "div",
          { class: `sg-marker-flag sg-marker-${marker.kind}`, title: marker.title },
          [marker.label],
        );
        flag.style.setProperty("left", `${px(marker.x)}px`);
        return flag;
      }),
    );
  }

  /** @param {TimelineFrame} frame */
  renderBackground(frame) {
    const { scale, rows, rowHeight } = frame;
    const [from, to] = this.chunk(frame);
    const height = rows.length * rowHeight;
    const lookahead = this.gantt.lookaheadWindow();
    const signature = `${scale.zoom}|${scale.start}|${from}|${to}|${height}|${this.gantt.calendarSignature()}|${lookahead?.from}-${lookahead?.to}`;
    if (signature === this.backgroundSignature) return;
    this.backgroundSignature = signature;
    const calendar = this.gantt.calendar;
    const children = [];
    if (lookahead) {
      children.push(
        svg("rect", {
          class: "sg-lookahead-window",
          x: px(scale.x(lookahead.from)),
          y: 0,
          width: px(scale.x(lookahead.to + 1) - scale.x(lookahead.from)),
          height,
        }),
      );
    }
    const shadeDays = scale.dayWidth >= 6;
    const firstDay = Math.max(scale.start, scale.dayAt(from));
    const lastDay = Math.min(scale.end, scale.dayAt(to) + 1);
    for (let day = firstDay; day < lastDay && shadeDays; day += 1) {
      if (calendar.isWorkingDayNumber(day)) continue;
      const reason = calendar.nonWorkingReason(day);
      const kind = reason?.kind ? ` sg-nonworking-${reason.kind}` : "";
      children.push(
        svg("rect", {
          class: `sg-nonworking${kind}`,
          x: px(scale.x(day)),
          y: 0,
          width: px(scale.dayWidth),
          height,
        }),
      );
    }
    for (const tickEntry of scale.ticks("bottom", from, to)) {
      children.push(
        svg("line", {
          class: "sg-gridline",
          x1: px(tickEntry.x),
          x2: px(tickEntry.x),
          y1: 0,
          y2: height,
        }),
      );
    }
    this.layers.background.replaceChildren(...children);
  }

  /** @param {TimelineFrame} frame */
  renderMarkers(frame) {
    const height = frame.rows.length * frame.rowHeight;
    this.layers.markers.replaceChildren(
      ...this.gantt.markerLines(frame.scale).map((marker) =>
        svg("line", {
          class: `sg-marker sg-marker-${marker.kind}`,
          x1: px(marker.x),
          x2: px(marker.x),
          y1: 0,
          y2: height,
        }),
      ),
    );
  }

  /** @param {TimelineFrame} frame */
  renderDelays(frame) {
    const { scale, rowHeight, rowIndex, rows } = frame;
    const children = [];
    for (const delay of this.gantt.store.list("delayEvents")) {
      const x = scale.x(toDay(delay.from));
      const width = scale.x(toDay(delay.to) + 1) - x;
      const indices = (delay.taskIds ?? [])
        .map((id) => rowIndex.get(id))
        .filter((index) => index !== undefined);
      const bands = delay.taskIds?.length
        ? indices.map((index) => [index * rowHeight, rowHeight])
        : [[0, rows.length * rowHeight]];
      for (const [y, height] of bands) {
        const rect = svg("rect", {
          class: `sg-delay sg-delay-${delay.kind ?? "other"}`,
          "data-delay-id": delay.id,
          x: px(x),
          y: px(y),
          width: px(width),
          height: px(height),
          fill: `url(#${this.hatchId})`,
        });
        children.push(rect);
      }
    }
    this.layers.delays.replaceChildren(...children);
  }

  /** @param {TimelineFrame} frame */
  renderBaselines(frame) {
    const baseline = this.gantt.visibleBaseline();
    if (!baseline) {
      this.layers.baselines.replaceChildren();
      return;
    }
    const { scale, rows, first, last, rowHeight } = frame;
    const children = [];
    for (let index = first; index < last; index += 1) {
      const dates = baseline.tasks?.[rows[index].id];
      if (!dates) continue;
      const geometry = this.geometry(rows[index], index, frame);
      const left = scale.x(toDay(dates.start));
      const right = rows[index].milestone ? left + 2 : scale.x(toDay(dates.finish) + 1);
      const y = geometry.top + geometry.height + 2;
      children.push(
        svg("rect", {
          class: "sg-baseline",
          "data-task-id": rows[index].id,
          x: px(left),
          y: px(Math.min(y, (index + 1) * rowHeight - 4)),
          width: px(Math.max(right - left, 2)),
          height: 3,
        }),
      );
    }
    this.layers.baselines.replaceChildren(...children);
  }

  /**
   * Geometry of a row's bar, using drag preview dates when present.
   * @param {import("./columns.js").Row} row
   * @param {number} index
   * @param {{scale: import("./scale.js").TimeScale, rowHeight: number}} frame
   * @returns {Geometry}
   */
  geometry(row, index, frame) {
    const { scale, rowHeight } = frame;
    const dates = this.gantt.displayDates(row);
    const barHeight = Math.round(rowHeight * (row.summary ? 0.3 : 0.56));
    const top = index * rowHeight + Math.round((rowHeight - barHeight) / 2);
    const y = index * rowHeight + rowHeight / 2;
    if (!dates) return { left: 0, right: 0, y, top, height: barHeight, point: false };
    if (row.milestone) {
      const x = this.gantt.isFinishAnchored(row.id)
        ? scale.x(dates.start + 1)
        : scale.x(dates.start);
      const size = Math.round(rowHeight * 0.5);
      return {
        left: x - size / 2,
        right: x + size / 2,
        y,
        top: y - size / 2,
        height: size,
        point: true,
      };
    }
    return {
      left: scale.x(dates.start),
      right: scale.x(dates.finish + 1),
      y,
      top,
      height: barHeight,
      point: false,
    };
  }

  /** @param {TimelineFrame} frame */
  renderTasks(frame) {
    const { rows, first, last } = frame;
    const wanted = new Set();
    for (let index = first; index < last; index += 1) {
      const row = rows[index];
      wanted.add(row.id);
      const geometry = this.geometry(row, index, frame);
      const state = this.gantt.taskState(row);
      const signature = JSON.stringify([
        geometry,
        state,
        row.task.name,
        row.task.value,
        row.dates?.progress,
        this.gantt.previewProgress(row.id),
      ]);
      let entry = this.tasks.get(row.id);
      if (!entry) {
        entry = { element: svg("g", { "data-task-id": row.id }), signature: "" };
        this.tasks.set(row.id, entry);
        this.layers.tasks.append(entry.element);
      }
      if (entry.signature === signature) continue;
      entry.signature = signature;
      this.drawTask(entry.element, row, geometry, state);
    }
    for (const [id, entry] of this.tasks) {
      if (wanted.has(id)) continue;
      entry.element.remove();
      this.tasks.delete(id);
    }
  }

  /**
   * @param {SVGElement} group
   * @param {import("./columns.js").Row} row
   * @param {Geometry} geometry
   * @param {ReturnType<import("./gantt.js").Gantt["taskState"]>} state
   */
  drawTask(group, row, geometry, state) {
    setAttributes(group, { class: state.classes.join(" ") });
    const parts = [];
    const type = row.task.type ?? "task";
    if (row.summary) parts.push(...summaryShape(geometry));
    else if (row.milestone) parts.push(milestoneShape(type, geometry));
    else
      parts.push(
        ...barShape(
          row,
          geometry,
          this.gantt.previewProgress(row.id),
          state.critical ? this.criticalId : null,
        ),
      );
    if (row.task.style?.color) parts[0].style.setProperty("--sg-task-color", row.task.style.color);
    const label = this.labelFor(row);
    if (label)
      parts.push(
        svg(
          "text",
          {
            class: "sg-bar-label",
            x: px(geometry.right + 6),
            y: px(geometry.y),
            "dominant-baseline": "central",
          },
          [label],
        ),
      );
    if (state.editable) parts.push(...handles(row, geometry, state, this.gantt.handleSize()));
    group.replaceChildren(...parts);
  }

  /**
   * @param {import("./columns.js").Row} row
   * @returns {string}
   */
  labelFor(row) {
    if (row.task.type === "payment" && typeof row.task.value === "number") {
      return `${row.task.name} · ${formatMoney(row.task.value, { locale: this.gantt.options.locale, currency: this.gantt.currency })}`;
    }
    return this.gantt.options.barLabels === false ? "" : row.task.name;
  }

  /** @param {TimelineFrame} frame */
  renderLinks(frame) {
    const { rows, first, last, rowIndex, rowHeight } = frame;
    const children = [];
    const selectedLink = this.gantt.selectedLinkId;
    for (const link of this.gantt.store.list("links")) {
      const fromIndex = rowIndex.get(link.from);
      const toIndex = rowIndex.get(link.to);
      if (fromIndex === undefined || toIndex === undefined) continue;
      const visible =
        (fromIndex >= first && fromIndex < last) || (toIndex >= first && toIndex < last);
      if (!visible) continue;
      const from = this.geometry(rows[fromIndex], fromIndex, frame);
      const to = this.geometry(rows[toIndex], toIndex, frame);
      const d = linkPath(link.type ?? "FS", from, to, { rowHeight });
      const critical =
        rows[fromIndex].schedule?.critical &&
        rows[toIndex].schedule?.critical &&
        this.gantt.showCriticalPath;
      const classes = ["sg-link", `sg-link-${(link.type ?? "FS").toLowerCase()}`];
      if (critical) classes.push("sg-critical");
      if (selectedLink === link.id) classes.push("sg-selected");
      const group = svg("g", { class: classes.join(" "), "data-link-id": link.id }, [
        svg("path", { class: "sg-link-hit", d }),
        svg("path", { class: "sg-link-line", d, "marker-end": `url(#${this.arrowId})` }),
      ]);
      children.push(group);
    }
    this.layers.links.replaceChildren(...children);
  }

  /**
   * Draws (or clears) the rubber-band line while creating a link.
   * @param {{x1: number, y1: number, x2: number, y2: number, valid: boolean}|null} line
   */
  drawLinkDraft(line) {
    if (!line) {
      this.layers.overlay.replaceChildren();
      return;
    }
    this.layers.overlay.replaceChildren(
      svg("line", {
        class: `sg-link-draft${line.valid ? " sg-valid" : ""}`,
        x1: px(line.x1),
        y1: px(line.y1),
        x2: px(line.x2),
        y2: px(line.y2),
        "marker-end": `url(#${this.arrowId})`,
      }),
    );
  }

  invalidate() {
    for (const entry of this.tasks.values()) entry.signature = "";
    this.backgroundSignature = "";
    this.scaleSignature = "";
  }

  destroy() {
    this.tasks.clear();
    this.element.remove();
  }
}

/**
 * @param {Geometry} geometry
 * @returns {SVGElement[]}
 */
export function summaryShape(geometry) {
  const { left, right, top, height } = geometry;
  const width = Math.max(right - left, 2);
  const cap = Math.min(6, width / 2);
  return [
    svg("path", {
      class: "sg-summary-shape sg-shape",
      d: `M${px(left)} ${px(top)} H${px(right)} V${px(top + height + cap)} L${px(right - cap)} ${px(top + height)} H${px(left + cap)} L${px(left)} ${px(top + height + cap)} Z`,
    }),
  ];
}

/**
 * @param {string} type
 * @param {Geometry} geometry
 * @returns {SVGElement}
 */
export function milestoneShape(type, geometry) {
  const x = (geometry.left + geometry.right) / 2;
  const { y, height } = geometry;
  const half = height / 2;
  if (type === "access" || type === "need-by") {
    const direction = type === "access" ? 1 : -1;
    const poleTop = y - half - 2;
    const poleBottom = y + half + 2;
    const flagY = direction === 1 ? poleTop : poleBottom - half;
    return svg("path", {
      class: `sg-shape sg-flag sg-${type}`,
      d: `M${px(x)} ${px(poleBottom)} V${px(poleTop)} M${px(x)} ${px(flagY)} h${px(half * 1.6)} l${px(-half * 0.5)} ${px(half / 2)} l${px(half * 0.5)} ${px(half / 2)} h${px(-half * 1.6)} Z`,
    });
  }
  return svg("path", {
    class: `sg-shape sg-milestone${type === "payment" ? " sg-payment" : ""}`,
    d: `M${px(x)} ${px(y - half)} L${px(x + half)} ${px(y)} L${px(x)} ${px(y + half)} L${px(x - half)} ${px(y)} Z`,
  });
}

/**
 * @param {import("./columns.js").Row} row
 * @param {Geometry} geometry
 * @param {number|undefined} previewProgress
 * @param {string|null} criticalPattern
 * @returns {SVGElement[]}
 */
export function barShape(row, geometry, previewProgress, criticalPattern) {
  const { left, right, top, height } = geometry;
  const width = Math.max(right - left, 2);
  const progress = previewProgress ?? row.dates?.progress ?? 0;
  const parts = [
    svg("rect", {
      class: `sg-shape sg-bar${row.task.type === "reference" ? " sg-reference" : ""}`,
      x: px(left),
      y: px(top),
      width: px(width),
      height,
      rx: 3,
    }),
  ];
  if (progress > 0)
    parts.push(
      svg("rect", {
        class: "sg-progress",
        x: px(left),
        y: px(top),
        width: px(width * Math.min(progress, 1)),
        height,
        rx: 3,
      }),
    );
  if (criticalPattern)
    parts.push(
      svg("rect", {
        class: "sg-critical-overlay",
        x: px(left),
        y: px(top),
        width: px(width),
        height,
        rx: 3,
        fill: `url(#${criticalPattern})`,
      }),
    );
  return parts;
}

/**
 * Drag handles: resize at both ends, progress, and link-creation dots.
 * @param {import("./columns.js").Row} row
 * @param {Geometry} geometry
 * @param {{resizable: boolean}} state
 * @param {number} size hit-target width in pixels
 * @returns {SVGElement[]}
 */
function handles(row, geometry, state, size) {
  const { left, right, top, height, y } = geometry;
  const parts = [
    svg("rect", {
      class: "sg-hit",
      "data-handle": "move",
      x: px(left),
      y: px(top - 2),
      width: px(Math.max(right - left, 4)),
      height: height + 4,
    }),
  ];
  if (state.resizable) {
    const half = size / 2;
    parts.push(
      svg("rect", {
        class: "sg-handle sg-handle-resize",
        "data-handle": "resize-start",
        x: px(left - half),
        y: px(top - 2),
        width: size,
        height: height + 4,
      }),
      svg("rect", {
        class: "sg-handle sg-handle-resize",
        "data-handle": "resize-end",
        x: px(right - half),
        y: px(top - 2),
        width: size,
        height: height + 4,
      }),
    );
    const progressX = left + (right - left) * (row.dates?.progress ?? 0);
    parts.push(
      svg("path", {
        class: "sg-handle sg-handle-progress",
        "data-handle": "progress",
        d: `M${px(progressX)} ${px(top + height - 1)} l5 7 h-10 z`,
      }),
    );
  }
  const dot = Math.max(5, size / 4);
  parts.push(
    svg("circle", {
      class: "sg-handle sg-handle-link",
      "data-handle": "link-start",
      cx: px(left - dot - 3),
      cy: px(y),
      r: dot,
    }),
    svg("circle", {
      class: "sg-handle sg-handle-link",
      "data-handle": "link-end",
      cx: px(right + dot + 3),
      cy: px(y),
      r: dot,
    }),
  );
  return parts;
}
