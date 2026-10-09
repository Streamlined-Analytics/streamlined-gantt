// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * The mutable programme document and its change records.
 *
 * Every mutation is expressed as a list of *records*: one per entity, holding
 * full before/after snapshots and the entity's position in its collection.
 * Applying records in order performs the change; applying their inverses in
 * reverse order undoes it exactly. History, optimistic rollback and
 * `getChanges()` are all built on this one primitive.
 *
 * @module model/store
 */

/**
 * @typedef {"tasks"|"links"|"delayEvents"|"markers"|"baselines"|"project"} Collection
 */

/**
 * @typedef {object} ChangeRecord
 * @property {Collection} collection
 * @property {string} id entity id (for "project", the top-level key)
 * @property {any} before snapshot before the change, or null when added
 * @property {any} after snapshot after the change, or null when removed
 * @property {number} beforeIndex position before (-1 when added)
 * @property {number} afterIndex position after (-1 when removed)
 * @property {string} cause what produced the change ("drag", "api", "schedule", …)
 */

export const ENTITY_COLLECTIONS = /** @type {const} */ ([
  "tasks",
  "links",
  "delayEvents",
  "markers",
  "baselines",
]);

/**
 * @param {unknown} first
 * @param {unknown} second
 * @returns {boolean}
 */
export function deepEqual(first, second) {
  if (first === second) return true;
  if (typeof first !== "object" || typeof second !== "object" || first === null || second === null)
    return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const firstKeys = Object.keys(first);
  if (firstKeys.length !== Object.keys(second).length) return false;
  return firstKeys.every((key) => Object.hasOwn(second, key) && deepEqual(first[key], second[key]));
}

/**
 * Top-level keys whose values differ, with nested `fields.<key>` paths for custom fields.
 * @param {Record<string, any>|null} before
 * @param {Record<string, any>|null} after
 * @returns {string[]}
 */
export function changedFields(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  for (const key of keys) {
    if (deepEqual(before[key], after[key])) continue;
    if (key !== "fields") {
      changed.push(key);
      continue;
    }
    const fieldKeys = new Set([
      ...Object.keys(before.fields ?? {}),
      ...Object.keys(after.fields ?? {}),
    ]);
    for (const fieldKey of fieldKeys) {
      if (!deepEqual(before.fields?.[fieldKey], after.fields?.[fieldKey]))
        changed.push(`fields.${fieldKey}`);
    }
  }
  return changed;
}

/**
 * @param {ChangeRecord} record
 * @returns {ChangeRecord}
 */
export function invertRecord(record) {
  return {
    ...record,
    before: record.after,
    after: record.before,
    beforeIndex: record.afterIndex,
    afterIndex: record.beforeIndex,
  };
}

/**
 * The live programme document.
 */
export class ProgrammeStore {
  /** @param {import("../engine/types.js").Programme} programme a validated copy, owned by the store */
  constructor(programme) {
    this.data = programme;
    /** @type {Map<Collection, Map<string, number>>} */
    this.indexes = new Map();
    this.reindex();
  }

  reindex() {
    this.indexes.clear();
    for (const collection of ENTITY_COLLECTIONS) {
      const list = /** @type {any[]} */ (this.data[collection] ?? []);
      this.indexes.set(collection, new Map(list.map((item, index) => [item.id, index])));
    }
  }

  /**
   * @param {Exclude<Collection, "project">} collection
   * @returns {any[]}
   */
  list(collection) {
    return /** @type {any[]} */ (this.data[collection] ?? []);
  }

  /**
   * @param {Exclude<Collection, "project">} collection
   * @param {string} id
   * @returns {any|undefined}
   */
  get(collection, id) {
    const index = this.indexes.get(collection)?.get(id);
    return index === undefined ? undefined : this.list(collection)[index];
  }

  /**
   * @param {Exclude<Collection, "project">} collection
   * @param {string} id
   * @returns {number}
   */
  indexOf(collection, id) {
    return this.indexes.get(collection)?.get(id) ?? -1;
  }

  /**
   * Builds the record that replaces an entity with `after` (null removes it).
   * @param {Collection} collection
   * @param {string} id
   * @param {any} after
   * @param {string} cause
   * @param {number} [afterIndex] defaults to the current index (or the end for additions)
   * @returns {ChangeRecord}
   */
  recordFor(collection, id, after, cause, afterIndex) {
    if (collection === "project") {
      const before = Object.hasOwn(this.data, id) ? structuredClone(this.data[id]) : null;
      return {
        collection,
        id,
        before,
        after: after === undefined ? null : after,
        beforeIndex: -1,
        afterIndex: -1,
        cause,
      };
    }
    const currentIndex = this.indexOf(collection, id);
    const before =
      currentIndex === -1 ? null : structuredClone(this.list(collection)[currentIndex]);
    const fallbackIndex = currentIndex === -1 ? this.list(collection).length : currentIndex;
    return {
      collection,
      id,
      before,
      after,
      beforeIndex: currentIndex,
      afterIndex: after === null ? -1 : (afterIndex ?? fallbackIndex),
      cause,
    };
  }

  /**
   * Applies records in order. Records must have been built against the
   * current state (or be the inverse of records just applied).
   * @param {ChangeRecord[]} records
   */
  apply(records) {
    for (const record of records) this.applyOne(record);
    this.reindex();
  }

  /**
   * Undoes records (applies their inverses in reverse order).
   * @param {ChangeRecord[]} records
   */
  revert(records) {
    this.apply([...records].reverse().map(invertRecord));
  }

  /** @param {ChangeRecord} record */
  applyOne(record) {
    if (record.collection === "project") {
      if (record.after === null) delete this.data[record.id];
      else this.data[record.id] = structuredClone(record.after);
      return;
    }
    const collection = record.collection;
    if (!Array.isArray(this.data[collection])) this.data[collection] = [];
    const list = /** @type {any[]} */ (this.data[collection]);
    const current = list.findIndex((item) => item.id === record.id);
    if (current !== -1) list.splice(current, 1);
    if (record.after === null) return;
    const position = Math.min(Math.max(record.afterIndex, 0), list.length);
    list.splice(position, 0, structuredClone(record.after));
  }

  /** @returns {import("../engine/types.js").Programme} */
  snapshot() {
    return structuredClone(this.data);
  }
}

/**
 * Compacts many records for the same entity into one (first before, last after).
 * Used when a transaction touches a task twice (the user's edit, then the scheduler).
 * @param {ChangeRecord[]} records
 * @returns {ChangeRecord[]}
 */
export function compactRecords(records) {
  /** @type {Map<string, ChangeRecord>} */
  const byEntity = new Map();
  for (const record of records) {
    const key = `${record.collection}\u0000${record.id}`;
    const existing = byEntity.get(key);
    if (!existing) {
      byEntity.set(key, { ...record });
      continue;
    }
    byEntity.set(key, { ...existing, after: record.after, afterIndex: record.afterIndex });
  }
  return [...byEntity.values()].filter(
    (record) =>
      !(deepEqual(record.before, record.after) && record.beforeIndex === record.afterIndex),
  );
}

/**
 * @param {any[]|undefined} list
 * @returns {Map<string, any>}
 */
function byId(list) {
  const map = new Map();
  for (const item of list ?? []) map.set(item.id, item);
  return map;
}

/**
 * The update entry for one entity: its id plus every top-level property that
 * differs (a removed property is sent as null).
 * @param {Record<string, any>} previous
 * @param {Record<string, any>} item
 * @returns {Record<string, any>}
 */
function patchBetween(previous, item) {
  const patch = { id: item.id };
  for (const key of new Set([...Object.keys(previous), ...Object.keys(item)])) {
    if (deepEqual(previous[key], item[key])) continue;
    patch[key] = item[key] === undefined ? null : structuredClone(item[key]);
  }
  return patch;
}

/**
 * The difference between two programme documents as a changeset that
 * `applyPatch()` accepts: `{tasks: {add, update, remove}, …, project}`.
 * Updates carry the id plus only the top-level properties that changed.
 * @param {import("../engine/types.js").Programme} clean
 * @param {import("../engine/types.js").Programme} current
 * @returns {import("../engine/types.js").Changeset}
 */
export function diffProgrammes(clean, current) {
  /** @type {Record<string, any>} */
  const changeset = {};
  for (const collection of ENTITY_COLLECTIONS) {
    const before = byId(clean[collection]);
    const after = byId(current[collection]);
    const add = [...after.values()]
      .filter((item) => !before.has(item.id))
      .map((item) => structuredClone(item));
    const remove = [...before.keys()].filter((id) => !after.has(id));
    const update = [];
    for (const [id, item] of after) {
      const previous = before.get(id);
      if (previous && !deepEqual(previous, item)) update.push(patchBetween(previous, item));
    }
    if (add.length || update.length || remove.length)
      changeset[collection] = { add, update, remove };
  }
  const project = {};
  for (const key of new Set([...Object.keys(clean), ...Object.keys(current)])) {
    if (ENTITY_COLLECTIONS.includes(/** @type {any} */ (key))) continue;
    if (!deepEqual(clean[key], current[key]))
      project[key] = current[key] === undefined ? null : structuredClone(current[key]);
  }
  if (Object.keys(project).length) changeset.project = project;
  return changeset;
}
