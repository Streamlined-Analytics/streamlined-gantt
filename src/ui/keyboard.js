// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Keyboard model for the treegrid (WCAG 2.2 AA). Every drag has a keyboard
 * alternative (2.5.7 Dragging Movements):
 *
 * | Keys | Action |
 * |---|---|
 * | ↑ ↓, Page Up/Down, Ctrl+Home/End | Move between rows |
 * | ← → | Move between cells; collapse/expand on the task-name cell |
 * | Home / End | First / last cell in the row |
 * | Space | Select or deselect the row (Ctrl+Space adds to the selection) |
 * | Enter or F2 | Edit the cell |
 * | Ctrl+Enter | Open the task editor |
 * | Alt+← → | Move the task one working day |
 * | Alt+Shift+← → | Shorten or lengthen the task by one working day |
 * | Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) | Undo / redo |
 * | Delete | Delete the task (asks first) |
 * | Shift+F10 or the Menu key | Context menu |
 * | Ctrl+K | Link to… (searchable task picker) |
 *
 * @module ui/keyboard
 */

export class KeyboardController {
  /** @param {import("./gantt.js").Gantt} gantt */
  constructor(gantt) {
    this.gantt = gantt;
    this.grid = gantt.grid.element;
    this.onKeyDown = (event) => this.handle(event);
    this.onFocusIn = (event) => this.syncFocus(event);
    this.onClick = (event) => this.onGridClick(event);
    this.onDoubleClick = (event) => this.onGridDoubleClick(event);
    this.grid.addEventListener("keydown", this.onKeyDown);
    this.grid.addEventListener("focusin", this.onFocusIn);
    this.grid.addEventListener("click", this.onClick);
    this.grid.addEventListener("dblclick", this.onDoubleClick);
  }

  /**
   * When the grid itself receives focus (its focused row was scrolled out),
   * bring the focused row back and focus its cell.
   * @param {FocusEvent} event
   */
  syncFocus(event) {
    const gantt = this.gantt;
    if (event.target === this.grid) {
      const taskId = gantt.focus.taskId ?? gantt.rows()[0]?.id;
      if (taskId) gantt.focusTask(taskId);
      return;
    }
    const cell = /** @type {HTMLElement} */ (event.target).closest?.("[role=gridcell]");
    const row = cell?.closest("[data-task-id]");
    if (!cell || !row) return;
    const taskId = row.getAttribute("data-task-id");
    const column = Number(cell.getAttribute("aria-colindex")) - 1;
    if (gantt.focus.taskId === taskId && gantt.focus.column === column) return;
    gantt.focus = { taskId, column };
    gantt.render();
  }

  /** @param {MouseEvent} event */
  onGridClick(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const row = target.closest("[data-task-id]");
    if (!row) return;
    const taskId = row.getAttribute("data-task-id");
    const gantt = this.gantt;
    if (target.closest("[data-action=toggle]")) {
      gantt.toggle(taskId);
      return;
    }
    const cell = target.closest("[role=gridcell]");
    const column = cell ? Number(cell.getAttribute("aria-colindex")) - 1 : 0;
    gantt.select([taskId], { additive: event.ctrlKey || event.metaKey });
    gantt.focusTask(taskId, { column, scroll: false });
    gantt.emit("row-click", {
      taskId,
      column: gantt.columns[column]?.id ?? null,
      originalEvent: event,
    });
  }

  /** @param {MouseEvent} event */
  onGridDoubleClick(event) {
    const row = /** @type {HTMLElement} */ (event.target).closest("[data-task-id]");
    if (!row) return;
    const taskId = row.getAttribute("data-task-id");
    const ev = this.gantt.emit("task-dblclick", {
      taskId,
      task: this.gantt.getTask(taskId),
      originalEvent: event,
    });
    if (ev) this.gantt.openEditor(taskId);
  }

  /** @param {KeyboardEvent} event */
  handle(event) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    const gantt = this.gantt;
    const taskId = gantt.focus.taskId;
    const command = this.command(event);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    command(taskId);
  }

  /**
   * Maps a key press to a command, or null when the key is not ours.
   * @param {KeyboardEvent} event
   * @returns {((taskId: string|null) => void)|null}
   */
  command(event) {
    return this.historyCommand(event) ?? this.editCommand(event) ?? this.navigation(event);
  }

  /**
   * Undo and redo.
   * @param {KeyboardEvent} event
   * @returns {((taskId: string|null) => void)|null}
   */
  historyCommand(event) {
    const gantt = this.gantt;
    const control = event.ctrlKey || event.metaKey;
    const isZ = event.key === "z" || event.key === "Z";
    if (control && isZ && !event.shiftKey) return () => gantt.undoWithAnnouncement();
    if (control && (event.key === "y" || (isZ && event.shiftKey)))
      return () => gantt.redoWithAnnouncement();
    return null;
  }

  /**
   * Task edits, menus and dialogs.
   * @param {KeyboardEvent} event
   * @returns {((taskId: string|null) => void)|null}
   */
  editCommand(event) {
    const gantt = this.gantt;
    const control = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (event.altKey && (key === "ArrowLeft" || key === "ArrowRight")) {
      const direction = key === "ArrowRight" ? 1 : -1;
      return event.shiftKey
        ? (id) => id && gantt.nudgeDuration(id, direction)
        : (id) => id && gantt.nudgeTask(id, direction);
    }
    const isContextMenuKey = (event.shiftKey && key === "F10") || key === "ContextMenu";
    if (isContextMenuKey) return (id) => id && gantt.openContextMenu(id, { keyboard: true });
    if (control && key === "Enter") return (id) => id && gantt.openEditor(id);
    if (control && (key === "k" || key === "K")) return (id) => id && gantt.openLinkPicker(id);
    const simple = {
      Delete: (id) => id && gantt.requestRemove(id),
      Enter: (id) => id && gantt.startCellEdit(id, gantt.focus.column),
      F2: (id) => id && gantt.startCellEdit(id, gantt.focus.column),
      " ": (id) => id && gantt.select([id], { additive: control, toggle: true }),
    };
    return simple[key] ?? null;
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {((taskId: string|null) => void)|null}
   */
  navigation(event) {
    const gantt = this.gantt;
    const control = event.ctrlKey || event.metaKey;
    const rows = gantt.rows();
    const lastColumn = gantt.columns.length - 1;
    const position = (id) => rows.findIndex((row) => row.id === id);
    const go = (index, column = gantt.focus.column) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
      if (row) gantt.focusTask(row.id, { column: Math.max(0, Math.min(lastColumn, column)) });
    };
    const page = Math.max(1, gantt.visibleRowCount() - 1);
    const map = {
      ArrowDown: (id) => go(position(id) + 1),
      ArrowUp: (id) => go(position(id) - 1),
      PageDown: (id) => go(position(id) + page),
      PageUp: (id) => go(position(id) - page),
      Home: (id) => (control ? go(0) : go(position(id), 0)),
      End: (id) => (control ? go(rows.length - 1) : go(position(id), lastColumn)),
      ArrowRight: (id) => this.right(id, rows, go, position),
      ArrowLeft: (id) => this.left(id, rows, go, position),
    };
    return map[event.key] ?? null;
  }

  /**
   * @param {string} id
   * @param {import("./columns.js").Row[]} rows
   * @param {(index: number, column?: number) => void} go
   * @param {(id: string) => number} position
   */
  right(id, rows, go, position) {
    const gantt = this.gantt;
    const row = rows[position(id)];
    const onTree = gantt.columns[gantt.focus.column]?.tree;
    if (onTree && row?.hasChildren && !row.expanded) {
      gantt.expand(id);
      return;
    }
    go(position(id), gantt.focus.column + 1);
  }

  /**
   * @param {string} id
   * @param {import("./columns.js").Row[]} rows
   * @param {(index: number, column?: number) => void} go
   * @param {(id: string) => number} position
   */
  left(id, rows, go, position) {
    const gantt = this.gantt;
    const row = rows[position(id)];
    const onTree = gantt.columns[gantt.focus.column]?.tree;
    if (onTree && row?.hasChildren && row.expanded) {
      gantt.collapse(id);
      return;
    }
    const parent = row?.task.parent;
    if (onTree && parent && position(parent) !== -1) {
      go(position(parent));
      return;
    }
    go(position(id), gantt.focus.column - 1);
  }

  destroy() {
    this.grid.removeEventListener("keydown", this.onKeyDown);
    this.grid.removeEventListener("focusin", this.onFocusIn);
    this.grid.removeEventListener("click", this.onClick);
    this.grid.removeEventListener("dblclick", this.onDoubleClick);
  }
}
