// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { validateProgramme } from "../engine/schema.js";
import { FieldRegistry } from "../engine/fields.js";

/**
 * Loading and serialising programme data. The stored object is a validated
 * deep copy of what the caller passed in; nothing is added or normalised on
 * load, so `toJSON()` returns data deep-equal to the input (unknown `fields`
 * keys and `x-*` extensions included).
 *
 * @module model/programme
 */

/**
 * Validates and deep-copies programme data.
 * @param {unknown} data
 * @param {{fields?: FieldRegistry}} [options]
 * @returns {import("../engine/types.js").Programme}
 * @throws {import("../engine/schema.js").GanttValidationError}
 */
export function loadProgramme(data, options = {}) {
  const fields = options.fields ?? new FieldRegistry();
  validateProgramme(data, {
    fieldValidator: (task, path, problems) => fields.checkStored(task, path, problems),
  });
  return structuredClone(/** @type {import("../engine/types.js").Programme} */ (data));
}

/**
 * Serialises stored data. Derived values (summary dates, floats, computed
 * fields) are never included.
 * @param {import("../engine/types.js").Programme} programme
 * @returns {import("../engine/types.js").Programme}
 */
export function serialiseProgramme(programme) {
  return structuredClone(programme);
}
