// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * A minimal structural diff and patch for JSON values. Importers use it to
 * carry what a native file format cannot represent: export computes
 * `diffValue(original, whatTheNativeFieldsRebuild)`, stores the patch in the
 * file, and import applies it to the natively rebuilt value. Only the parts
 * that differ are stored, so a calendar whose holidays lost their `kind`
 * stores just the kinds, not the whole holiday list.
 *
 * Object edits are written in sorted key order, so the same difference
 * always serialises to the same JSON whatever the key order of the input.
 *
 * A patch is one of:
 * - `{"=": value}`: replace with `value`;
 * - `{"o": {key: patch}, "d": [key, ...]}`: edit an object key by key and delete keys;
 * - `{"a": [patch | 0, ...]}`: edit an array of the same length element by element.
 *
 * @module io/residue
 */

/** Assigning this key would replace the prototype; every other key is an own property. */
const PROTOTYPE_KEY = "__proto__";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} first
 * @param {unknown} second
 * @returns {boolean}
 */
function sameValue(first, second) {
  if (first === second) return true;
  if (typeof first !== "object" || typeof second !== "object" || !first || !second) return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const firstKeys = Object.keys(first);
  if (firstKeys.length !== Object.keys(second).length) return false;
  return firstKeys.every((key) => Object.hasOwn(second, key) && sameValue(first[key], second[key]));
}

/**
 * The patch that turns `rebuilt` into `original`, or undefined when equal.
 * @param {unknown} original
 * @param {unknown} rebuilt
 * @returns {object|undefined}
 */
export function diffValue(original, rebuilt) {
  if (sameValue(original, rebuilt)) return undefined;
  if (isPlainObject(original) && isPlainObject(rebuilt)) return diffObject(original, rebuilt);
  const sameLengthArrays =
    Array.isArray(original) && Array.isArray(rebuilt) && original.length === rebuilt.length;
  if (sameLengthArrays)
    return { a: original.map((item, index) => diffValue(item, rebuilt[index]) ?? 0) };
  return { "=": original };
}

/**
 * @param {Record<string, unknown>} original
 * @param {Record<string, unknown>} rebuilt
 * @returns {object}
 */
function diffObject(original, rebuilt) {
  /** @type {Record<string, object>} */
  const edits = {};
  for (const key of Object.keys(original).sort()) {
    const value = original[key];
    const edit = Object.hasOwn(rebuilt, key) ? diffValue(value, rebuilt[key]) : { "=": value };
    if (edit) edits[key] = edit;
  }
  const deleted = Object.keys(rebuilt)
    .filter((key) => !Object.hasOwn(original, key))
    .sort();
  return {
    ...(Object.keys(edits).length ? { o: edits } : {}),
    ...(deleted.length ? { d: deleted } : {}),
  };
}

/**
 * Applies a patch from {@link diffValue}. A patch that no longer fits (an
 * array whose length changed because the file was edited elsewhere) leaves
 * that part of the rebuilt value as it is.
 * @param {unknown} rebuilt
 * @param {any} patch
 * @returns {any}
 */
export function applyPatch(rebuilt, patch) {
  if (!isPlainObject(patch)) return rebuilt;
  if (Object.hasOwn(patch, "=")) return structuredClone(patch["="]);
  if (Array.isArray(patch.a)) return patchArray(rebuilt, patch.a);
  return patchObject(rebuilt, patch);
}

/**
 * @param {unknown} rebuilt
 * @param {unknown[]} edits
 * @returns {unknown}
 */
function patchArray(rebuilt, edits) {
  if (!Array.isArray(rebuilt) || rebuilt.length !== edits.length) return rebuilt;
  return rebuilt.map((item, index) => applyPatch(item, edits[index]));
}

/**
 * @param {unknown} rebuilt
 * @param {{o?: Record<string, unknown>, d?: unknown}} patch
 * @returns {Record<string, unknown>}
 */
function patchObject(rebuilt, patch) {
  /** @type {Record<string, unknown>} */
  const result = isPlainObject(rebuilt) ? { ...rebuilt } : {};
  for (const [key, edit] of Object.entries(isPlainObject(patch.o) ? patch.o : {})) {
    if (key !== PROTOTYPE_KEY) result[key] = applyPatch(result[key], edit);
  }
  for (const key of Array.isArray(patch.d) ? patch.d : []) {
    if (typeof key === "string") delete result[key];
  }
  return result;
}
