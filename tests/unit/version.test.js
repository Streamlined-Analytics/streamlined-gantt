// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { test } from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "../../src/index.js";

test("source builds expose a development version string", () => {
  assert.equal(VERSION, "0.0.0-dev");
});
