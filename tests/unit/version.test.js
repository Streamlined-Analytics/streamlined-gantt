// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "vitest";
import { VERSION } from "../../src/engine/index.js";

test("source builds expose a development version string", () => {
  expect(VERSION).toBe("0.0.0-dev");
});
