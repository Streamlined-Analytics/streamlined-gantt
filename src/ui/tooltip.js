// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toDay } from "../engine/dates.js";
import { formatDate, formatMoney, formatPercent } from "../engine/format.js";
import { html, setContent } from "./dom.js";
import { fill } from "./strings.js";

/**
 * One shared tooltip, shown after a short hover. Content defaults to the
 * name, inclusive en-GB dates, working-day duration, progress, float, value
 * and baseline variance; `tooltip(task, context)` replaces it with a string
 * (rendered as text), a Node, or `trustedHTML()`. `tooltip: false` disables it.
 *
 * @module ui/tooltip
 */

const SHOW_DELAY = 250;

export class Tooltip {
  /** @param {import("./gantt.js").Gantt} gantt */
  constructor(gantt) {
    this.gantt = gantt;
    this.element = html("div", {
      class: "sg-tooltip",
      role: "tooltip",
      id: `${gantt.uid}-tooltip`,
      hidden: true,
    });
    gantt.root.append(this.element);
    this.timer = 0;
  }

  /**
   * @param {string} taskId
   * @param {{clientX: number, clientY: number}} point
   */
  show(taskId, point) {
    if (this.gantt.options.tooltip === false || this.gantt.pointer?.dragging) return;
    this.cancel();
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      const task = this.gantt.getTask(taskId);
      if (!task) return;
      const custom = this.gantt.options.tooltip;
      setContent(
        this.element,
        typeof custom === "function"
          ? custom(task, { gantt: this.gantt })
          : this.defaultContent(task),
      );
      this.element.hidden = false;
      this.position(point);
    }, SHOW_DELAY);
  }

  /** @param {{clientX: number, clientY: number}} point */
  position(point) {
    const root = this.gantt.root.getBoundingClientRect();
    const box = this.element.getBoundingClientRect();
    const left = Math.min(point.clientX - root.left + 12, root.width - box.width - 4);
    const top =
      point.clientY - root.top + 16 + box.height > root.height
        ? point.clientY - root.top - box.height - 8
        : point.clientY - root.top + 16;
    this.element.style.setProperty("left", `${Math.max(4, left)}px`);
    this.element.style.setProperty("top", `${Math.max(4, top)}px`);
  }

  /**
   * @param {Readonly<Record<string, any>>} task
   * @returns {Node}
   */
  defaultContent(task) {
    const { strings: s, options } = this.gantt;
    const locale = options.locale;
    const date = (iso) => formatDate(toDay(iso), locale);
    const days = (count) => (Math.abs(count) === 1 ? s.workingDay : s.workingDays);
    const lines = [];
    if (task.start)
      lines.push(
        task.start === task.finish
          ? date(task.start)
          : `${date(task.start)} – ${date(task.finish)}`,
      );
    if (task.start && task.duration)
      lines.push(fill(s.tooltipDuration, { duration: task.duration, days: days(task.duration) }));
    if (task.duration)
      lines.push(fill(s.tooltipProgress, { percent: formatPercent(task.progress ?? 0, locale) }));
    if (task.float)
      lines.push(fill(s.tooltipFloat, { float: task.float.total, days: days(task.float.total) }));
    if (typeof task.value === "number")
      lines.push(formatMoney(task.value, { locale, currency: this.gantt.currency }));
    const variance = this.gantt.rowById(task.id)?.variance;
    if (variance)
      lines.push(
        fill(s.tooltipVariance, {
          variance: variance > 0 ? `+${variance}` : variance,
          days: days(variance),
        }),
      );
    const fragment = document.createDocumentFragment();
    fragment.append(
      html("strong", {}, [task.name]),
      ...lines.map((line) => html("div", {}, [line])),
    );
    return fragment;
  }

  cancel() {
    if (!this.timer) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
  }

  hide() {
    this.cancel();
    this.element.hidden = true;
  }

  destroy() {
    this.hide();
    this.element.remove();
  }
}
