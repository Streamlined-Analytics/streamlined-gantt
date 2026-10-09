// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { html } from "./dom.js";

/**
 * The context menu: a keyboard-operable `role="menu"` opened by right-click,
 * long-press, Shift+F10 or the Menu key. Arrow keys, Home and End move
 * between items; Enter or Space chooses; Esc and Tab close and return focus.
 *
 * Items are `{id, label, when(context), action(context), danger}`. The
 * `contextMenu.items` option replaces the defaults; `contextMenu: false`
 * disables the menu. Choosing an item emits `menu-action`.
 *
 * @module ui/menu
 */

/**
 * @typedef {object} MenuItem
 * @property {string} id
 * @property {string} label
 * @property {(context: MenuContext) => boolean} [when]
 * @property {(context: MenuContext) => unknown} action
 * @property {boolean} [danger]
 */

/**
 * @typedef {object} MenuContext
 * @property {import("./gantt.js").Gantt} gantt
 * @property {string} taskId
 * @property {Readonly<Record<string, any>>} task
 * @property {string|null} date ISO date under the pointer, when opened by pointer
 */

/**
 * @param {import("./gantt.js").Gantt} gantt
 * @returns {MenuItem[]}
 */
export function defaultMenuItems(gantt) {
  const s = gantt.strings;
  const editable = (context) => !context.gantt.readOnly;
  const leafEditable = (context) => editable(context) && !context.task.summary;
  return [
    {
      id: "edit",
      label: s.menuEdit,
      action: (context) => context.gantt.openEditor(context.taskId),
    },
    {
      id: "add-below",
      label: s.menuAddBelow,
      when: editable,
      action: (context) => context.gantt.addBelow(context.taskId, "task"),
    },
    {
      id: "add-milestone",
      label: s.menuAddMilestone,
      when: editable,
      action: (context) => context.gantt.addBelow(context.taskId, "milestone"),
    },
    {
      id: "indent",
      label: s.menuIndent,
      when: editable,
      action: (context) => context.gantt.indentTask(context.taskId),
    },
    {
      id: "outdent",
      label: s.menuOutdent,
      when: (context) => editable(context) && Boolean(context.task.parent),
      action: (context) => context.gantt.outdentTask(context.taskId),
    },
    {
      id: "link",
      label: s.menuLink,
      when: leafEditable,
      action: (context) => context.gantt.openLinkPicker(context.taskId),
    },
    {
      id: "delay",
      label: s.menuDelay,
      when: (context) => editable(context) && Boolean(context.date),
      action: (context) =>
        context.gantt.addDelayEvent(
          {
            kind: "other",
            from: context.date,
            to: context.date,
            taskIds: [context.taskId],
            title: s.menuDelay,
          },
          { cause: "menu" },
        ),
    },
    {
      id: "copy-id",
      label: s.menuCopyId,
      action: (context) => copyTaskId(context),
    },
    {
      id: "delete",
      label: s.menuDelete,
      danger: true,
      when: editable,
      action: (context) => context.gantt.requestRemove(context.taskId),
    },
  ];
}

export class ContextMenu {
  /** @param {import("./gantt.js").Gantt} gantt */
  constructor(gantt) {
    this.gantt = gantt;
    this.element = null;
    this.returnFocus = null;
    this.onOutside = (event) => {
      if (this.element && !this.element.contains(/** @type {Node} */ (event.target))) this.close();
    };
  }

  /**
   * @param {MenuContext} context
   * @param {{clientX?: number, clientY?: number}} point
   * @returns {boolean}
   */
  open(context, point) {
    this.close();
    const configured = this.gantt.options.contextMenu;
    if (configured === false) return false;
    const items = (configured?.items ?? defaultMenuItems(this.gantt)).filter(
      (item) => !item.when || item.when(context),
    );
    if (!items.length) return false;
    this.returnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
    const menu = html("div", {
      class: "sg-menu",
      role: "menu",
      "aria-label": this.gantt.strings.menuLabel,
      tabindex: "-1",
    });
    for (const item of items) {
      const entry = html(
        "div",
        {
          class: `sg-menu-item${item.danger ? " sg-danger" : ""}`,
          role: "menuitem",
          tabindex: "-1",
          "data-action": item.id,
        },
        [item.label],
      );
      entry.addEventListener("click", () => this.choose(item, context));
      menu.append(entry);
    }
    menu.addEventListener("keydown", (event) => this.onKeyDown(event, items, context));
    this.element = menu;
    this.gantt.root.append(menu);
    this.place(point);
    /** @type {HTMLElement} */ (menu.firstElementChild).focus();
    document.addEventListener("pointerdown", this.onOutside, true);
    return true;
  }

  /** @param {{clientX?: number, clientY?: number}} point */
  place(point) {
    const root = this.gantt.root.getBoundingClientRect();
    const box = this.element.getBoundingClientRect();
    const anchor =
      point.clientX === undefined
        ? this.focusAnchor()
        : { x: point.clientX - root.left, y: point.clientY - root.top };
    const left = Math.max(4, Math.min(anchor.x, root.width - box.width - 4));
    const top = Math.max(4, Math.min(anchor.y, root.height - box.height - 4));
    this.element.style.setProperty("left", `${left}px`);
    this.element.style.setProperty("top", `${top}px`);
  }

  /** @returns {{x: number, y: number}} below the focused cell, for keyboard opening */
  focusAnchor() {
    const root = this.gantt.root.getBoundingClientRect();
    const { grid, timeline, focus, timelineOnly } = this.gantt;
    const cell = (
      timelineOnly
        ? timeline.tasks.get(focus.taskId)?.element
        : grid.cell(focus.taskId, focus.column)
    )?.getBoundingClientRect();
    return cell ? { x: cell.left - root.left + 8, y: cell.bottom - root.top } : { x: 8, y: 8 };
  }

  /**
   * @param {KeyboardEvent} event
   * @param {MenuItem[]} items
   * @param {MenuContext} context
   */
  onKeyDown(event, items, context) {
    const entries = /** @type {HTMLElement[]} */ ([...this.element.children]);
    const current = entries.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const move = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: entries.length - 1 }[
      event.key
    ];
    if (move !== undefined) {
      event.preventDefault();
      entries[(move + entries.length) % entries.length].focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.choose(items[current], context);
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      this.close();
    }
  }

  /**
   * @param {MenuItem} item
   * @param {MenuContext} context
   */
  choose(item, context) {
    this.close();
    this.gantt.emit("menu-action", { action: item.id, taskId: context.taskId, date: context.date });
    item.action(context);
  }

  get isOpen() {
    return Boolean(this.element);
  }

  close() {
    if (!this.element) return;
    document.removeEventListener("pointerdown", this.onOutside, true);
    this.element.remove();
    this.element = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }

  destroy() {
    this.close();
  }
}

/**
 * Copies a task id, announcing the outcome; the clipboard can be refused
 * (permissions, insecure context), which must not become an unhandled rejection.
 * @param {{gantt: import("./gantt.js").Gantt, taskId: string}} context
 * @returns {Promise<void>}
 */
async function copyTaskId(context) {
  const s = context.gantt.strings;
  try {
    await globalThis.navigator.clipboard.writeText(context.taskId);
    context.gantt.announce(s.copiedId);
  } catch {
    context.gantt.announce(s.copyFailed);
  }
}
