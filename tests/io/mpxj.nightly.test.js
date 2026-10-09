// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { collectProblems } from "../../src/engine/schema.js";
import { fromMSPDI, toMSPDI } from "../../src/io/mspdi.js";

/**
 * Imports MS Project files from the MPXJ test corpus. They are LGPL, so the
 * nightly workflow fetches them at a pinned commit and checks their SHA-256
 * before this runs; they are never committed (ADR-0008). Skipped unless
 * SG_MPXJ_DIR points at the downloaded files.
 */
const directory = process.env.SG_MPXJ_DIR;
const read = (name) => fromMSPDI(readFileSync(join(String(directory), name), "utf8"));

describe.skipIf(!directory)("MPXJ sample files", () => {
  test.each(["task-links.xml", "task-text.xml", "recurring.xml"])(
    "%s imports to valid data and round-trips through our own export",
    (name) => {
      const { programme } = read(name);
      expect(collectProblems(programme)).toEqual([]);
      const again = fromMSPDI(toMSPDI(programme));
      expect(again.programme).toEqual(programme);
    },
  );

  test("task-links: every link type and lag", () => {
    const { programme, warnings } = read("task-links.xml");
    expect(warnings).toEqual([]);
    expect(programme.links.map(({ type = "FS", lag = 0 }) => `${type}${lag}`)).toEqual([
      "FS0",
      "FS1",
      "FS2",
      "FS5",
      "FS10",
      "SF2",
      "SS2",
      "FF2",
    ]);
  });

  test("task-text: thirty tasks; Text fields are not mistaken for ids, trade or crew", () => {
    const { programme } = read("task-text.xml");
    expect(programme.tasks).toHaveLength(30);
    expect(
      programme.tasks.every(
        (task) => task.id === `t${task.id.slice(1)}` && !task.trade && !task.crew,
      ),
    ).toBe(true);
  });

  test("recurring exceptions expand as MS Project defines them", () => {
    const { programme } = read("recurring.xml");
    const byName = {};
    for (const entry of programme.calendars[0].nonWorking ?? []) {
      (byName[entry.name] ??= []).push(entry.date ?? `${entry.from}..${entry.to}`);
    }
    expect(byName["Daily 1"]).toEqual(["2000-01-01..2000-01-03"]);
    expect(byName["Daily 2"]).toEqual(["2000-02-01", "2000-02-04", "2000-02-07", "2000-02-10"]);
    expect(byName["Weekly 2 Tuesday"]).toEqual([
      "2001-01-02",
      "2001-01-16",
      "2001-01-30",
      "2001-02-13",
    ]);
    expect(byName["Monthly Relative 5"]?.slice(0, 2)).toEqual(["2002-01-25", "2002-07-26"]);
    expect(byName["Yearly Relative 1"]).toEqual([
      "2004-03-02",
      "2005-03-01",
      "2006-03-07",
      "2007-03-06",
    ]);
    expect(byName["Yearly Absolute 1"]).toEqual(["2005-02-01", "2006-02-01", "2007-02-01"]);
    expect(Object.keys(byName)).not.toContain("undefined");
  });
});
