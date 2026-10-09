// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  FieldRegistry,
  analyse,
  csvCell,
  minorToDecimal,
  programmeToCSV,
} from "../../src/engine/index.js";
import { loadFixture } from "../support/builders.js";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";
import { lazy } from "../support/lazy.js";

describe("CSV export", () => {
  const programme = loadFixture("programmes/flat-roof.json");
  const csv = lazy(() => ({
    text: programmeToCSV(
      analyse(programme, { fields: new FieldRegistry(FLAT_ROOF_FIELDS) }),
      programme,
    ),
  }));
  const lines = lazy(() => csv.text.split("\r\n"));

  test("has a header, one row per task in tree order and a trailing CRLF", () => {
    expect(lines[0]).toBe(
      "id,wbs,name,type,level,start,finish,duration,progress,predecessors,value,Cost,Charge,Qty,Profit,Margin %,Supplier",
    );
    expect(lines).toHaveLength(programme.tasks.length + 2);
    expect(lines.at(-1)).toBe("");
  });

  test("summaries roll up dates and money is written in major units", () => {
    expect(lines[1]).toBe(
      "s1,1,Preliminaries,summary,1,2026-11-02,2026-11-04,3,1,,,1200.00,1800.00,,600.00,0.3333333333333333,",
    );
    expect(lines[3]).toBe(
      "t1,1.2,Site set-up and scaffold,task,2,2026-11-02,2026-11-04,3,1,a1FS,,1200.00,1800.00,,600.00,0.3333333333333333,",
    );
    expect(lines.find((line) => line.startsWith("p2,"))).toBe(
      "p2,2.6,Stage payment 2: watertight (50%),payment,2,2026-11-25,2026-11-25,0,0,t6FS,9000.00,,,,0.00,,",
    );
  });

  test("can restrict and order rows", () => {
    const only = programmeToCSV(analyse(programme), programme, { ids: ["t3"] }).split("\r\n");
    expect(only).toHaveLength(3);
    expect(only[1]).toMatch(/^t3,2.2,Deck repairs,task,2,2026-11-10,2026-11-12,3,0,t2FS,$/);
  });

  test("lags and leads appear in the predecessor column; summaries without dates are blank", () => {
    const data = {
      tasks: [
        { id: "e", name: "Empty", type: "summary" },
        { id: "a", name: "A", start: "2026-11-02", duration: 2 },
        { id: "b", name: "B", start: "2026-11-02", duration: 2 },
      ],
      links: [
        { id: "1", from: "a", to: "b", type: "SS", lag: 2 },
        { id: "2", from: "e", to: "b", lag: -1 },
      ],
    };
    const rows = programmeToCSV(analyse(data), data).split("\r\n");
    expect(rows[1]).toBe("e,,Empty,summary,1,,,,,,");
    expect(rows[3]).toBe("b,,B,task,1,2026-11-02,2026-11-03,2,0,aSS+2;eFS-1,");
  });

  test("quotes and escapes cells and blocks formula injection", () => {
    expect(csvCell('Say "hi", then go')).toBe('"Say ""hi"", then go"');
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+44 1234")).toBe("'+44 1234");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  test("minor units to decimals", () => {
    expect(minorToDecimal(540000)).toBe("5400.00");
    expect(minorToDecimal(-5)).toBe("-0.05");
    expect(minorToDecimal(123456789)).toBe("1234567.89");
  });
});
