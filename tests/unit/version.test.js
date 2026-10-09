// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "vitest";
import { VERSION } from "../../src/engine/index.js";

test("source builds expose a development version string", () => {
  expect(VERSION).toBe("0.0.0-dev");
});

test("the compact event-name list matches the documented catalogue", async () => {
  const { EVENT_NAME_LIST } = await import("../../src/model/event-names.js");
  const { EVENT_CATALOGUE } = await import("../../src/events.js");
  expect([...EVENT_NAME_LIST]).toEqual(EVENT_CATALOGUE.map((spec) => spec.name));
});
