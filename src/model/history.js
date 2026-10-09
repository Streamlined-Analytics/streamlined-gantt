// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Undo/redo history of committed transactions.
 *
 * Each entry holds the raw change records of one transaction, so undo is the
 * exact inverse. The stack is capped (100 entries by default; the oldest are
 * dropped). A new edit after an undo clears the redo stack.
 *
 * A server patch applied with `undoable: false` is authoritative: undo must
 * never overwrite it. When such a patch touches an entity, every history entry
 * that touched the same entity is discarded together with everything older
 * than it, and the redo stack is cleared (ADR-0006). Entries newer than the
 * last one touching that entity, which only touch other entities, stay undoable.
 *
 * @module model/history
 */

/**
 * @typedef {object} HistoryEntry
 * @property {string} transactionId
 * @property {string} label
 * @property {string} cause
 * @property {import("./store.js").ChangeRecord[]} records
 */

/**
 * @param {import("./store.js").ChangeRecord} record
 * @returns {string}
 */
const entityKey = (record) => `${record.collection}\u0000${record.id}`;

export class History {
  /** @param {{limit?: number}} [options] */
  constructor(options = {}) {
    this.limit = options.limit ?? 100;
    /** @type {HistoryEntry[]} */
    this.undoStack = [];
    /** @type {HistoryEntry[]} */
    this.redoStack = [];
  }

  /** @param {HistoryEntry} entry */
  push(entry) {
    if (!entry.records.length) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit)
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /** @returns {HistoryEntry|undefined} the entry to revert; moved to the redo stack */
  takeUndo() {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
    return entry;
  }

  /** @returns {HistoryEntry|undefined} the entry to re-apply; moved back to the undo stack */
  takeRedo() {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
    return entry;
  }

  /**
   * Makes room for an authoritative, non-undoable patch.
   * @param {import("./store.js").ChangeRecord[]} records the patch's records
   */
  protect(records) {
    if (!records.length) return;
    const touched = new Set(records.map(entityKey));
    this.redoStack = [];
    let newestConflict = -1;
    this.undoStack.forEach((entry, index) => {
      if (entry.records.some((record) => touched.has(entityKey(record)))) newestConflict = index;
    });
    if (newestConflict >= 0) this.undoStack.splice(0, newestConflict + 1);
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
