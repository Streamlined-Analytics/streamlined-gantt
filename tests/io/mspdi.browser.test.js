// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import flatRoof from "../../examples/data/flat-roof.json";
import foreignXml from "../fixtures/mspdi/foreign-project.xml?raw";
import { MspdiParseError, fromMSPDI, toMSPDI } from "../../src/io/mspdi.js";

/**
 * The MSPDI module in a real browser: no Node APIs, no DOMParser, and the
 * same output as in Node (the engine suite checks the details).
 */
describe("MSPDI in the browser", () => {
  test("the flat-roof example round-trips and re-exports byte-identically", () => {
    const xml = toMSPDI(flatRoof);
    const { programme, warnings } = fromMSPDI(xml);
    expect(warnings).toEqual([]);
    expect(programme).toEqual(flatRoof);
    expect(toMSPDI(programme)).toBe(xml);
  });

  test("an export can be offered as a download and read back from a File", async () => {
    const blob = new Blob([toMSPDI(flatRoof)], { type: "application/xml" });
    const file = new File([blob], "flat-roof.xml", { type: "application/xml" });
    expect(fromMSPDI(await file.text()).programme).toEqual(flatRoof);
  });

  test("a file from another tool imports with warnings", () => {
    const { programme, warnings } = fromMSPDI(foreignXml);
    expect(programme.tasks).toHaveLength(6);
    expect(warnings).toHaveLength(4);
  });

  test("external entities are refused", () => {
    expect(() =>
      fromMSPDI('<!DOCTYPE p [<!ENTITY x SYSTEM "http://example.com/">]><Project/>'),
    ).toThrow(MspdiParseError);
  });
});
