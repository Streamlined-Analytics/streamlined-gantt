// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  MspdiParseError,
  XmlWriter,
  child,
  children,
  escapeXml,
  parseXml,
  textOf,
} from "../../src/io/xml.js";

describe("parseXml", () => {
  test("reads elements, text, attributes and strips namespace prefixes", () => {
    const root = parseXml(
      '﻿<?xml version="1.0"?>\n<!-- c --><p:Project xmlns:p="urn:x" a=\'1\' b="two &amp; three"><Name>A</Name><Name>B</Name><Empty/></p:Project>\n',
    );
    expect(root.name).toBe("Project");
    expect(root.attributes).toMatchObject({ a: "1", b: "two & three" });
    expect(children(root, "Name").map((element) => element.text)).toEqual(["A", "B"]);
    expect(child(root, "Empty")).toMatchObject({ name: "Empty", text: "", children: [] });
    expect(textOf(root, "Missing")).toBeUndefined();
    expect(textOf(undefined, "Name")).toBeUndefined();
    expect(children(undefined, "Name")).toEqual([]);
  });

  test("decodes the predefined entities, numeric references and CDATA", () => {
    const root = parseXml(
      "<a><b>&lt;&gt;&amp;&quot;&apos; &#169; &#x1F3D7;</b><c><![CDATA[<raw> & ]]></c></a>",
    );
    expect(textOf(root, "b")).toBe("<>&\"' © \u{1F3D7}");
    expect(child(root, "c")?.text).toBe("<raw> & ");
  });

  test("a > inside a quoted attribute does not end the tag", () => {
    expect(parseXml('<a title="x > y"><b/></a>').attributes.title).toBe("x > y");
  });

  const rejected = [
    [
      "an external entity (XXE)",
      '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
      "DOCTYPE",
    ],
    [
      "entity expansion (billion laughs)",
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><lolz>&lol2;</lolz>',
      "DOCTYPE",
    ],
    ["an unknown entity", "<a>&nbsp;</a>", "Unknown entity"],
    ["an unescaped ampersand", "<a>fish & chips</a>", "Unescaped &"],
    ["an out-of-range character reference", "<a>&#x110000;</a>", "Invalid character reference"],
    ["a mismatched closing tag", "<a><b></a></b>", "Unexpected closing tag"],
    ["an unclosed element", "<a><b></b>", "Unclosed element <a>"],
    ["two root elements", "<a/><b/>", "More than one root"],
    ["text outside the root", "<a/>junk", "Text outside the root"],
    ["leading text", "junk<a/>", "Text outside the root"],
    ["an empty document", "  ", "No root element"],
    ["an unterminated comment", "<a><!-- x</a>", "Unterminated comment"],
    ["an unterminated processing instruction", "<?xml <a/>", "Unterminated processing instruction"],
    ["an unterminated CDATA section", "<a><![CDATA[x</a>", "Unterminated CDATA"],
    ["CDATA outside the root", "<![CDATA[x]]><a/>", "CDATA outside"],
    ["an unterminated start tag", "<a <b/>", "Unterminated start tag"],
    ["an unterminated closing tag", "<a></a", "Unterminated closing tag"],
    ["a tag without a name", "< />", "Missing element name"],
  ];

  test.each(rejected)("rejects %s", (_label, source, message) => {
    expect(() => parseXml(source)).toThrow(MspdiParseError);
    expect(() => parseXml(source)).toThrow(message);
  });

  test("reports the line and column of the problem", () => {
    try {
      parseXml("<a>\n  <b>\n  </c>\n</a>");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MspdiParseError);
      expect(error).toMatchObject({ name: "MspdiParseError", line: 3 });
      expect(error.column).toBeGreaterThan(0);
    }
  });
});

describe("XmlWriter and escapeXml", () => {
  test("escapes markup characters and drops characters XML 1.0 cannot carry", () => {
    expect(escapeXml(`a<b>&"c'\u0001\u0008\u000b\u001f\ufffe\uffff\td\n`)).toBe(
      "a&lt;b&gt;&amp;&quot;c'\td\n",
    );
  });

  test("drops lone surrogates but keeps astral characters (surrogate pairs)", () => {
    expect(escapeXml("x\ud800y\udfffz\udc00\ud800\u{1F3D7}")).toBe("xyz\u{1F3D7}");
  });

  test("writes a carriage return as a character reference, which the reader decodes", () => {
    expect(escapeXml("a\r\nb")).toBe("a&#13;\nb");
    const writer = new XmlWriter();
    writer.write("Root", "a\r\nb", 0);
    expect(parseXml(writer.toString()).text).toBe("a\r\nb");
  });

  test("writes nested elements, skips undefined values and round-trips through the parser", () => {
    const writer = new XmlWriter();
    writer.write(
      "Root",
      [
        ["Name", "R & D <1>"],
        ["Skipped", undefined],
        ["Null", null],
        ["Empty", []],
        ["Count", 0],
        ["Nested", [["Leaf", "x"]]],
      ],
      0,
      ' xmlns="urn:test"',
    );
    const xml = writer.toString();
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Root xmlns="urn:test">',
        "\t<Name>R &amp; D &lt;1&gt;</Name>",
        "\t<Empty/>",
        "\t<Count>0</Count>",
        "\t<Nested>",
        "\t\t<Leaf>x</Leaf>",
        "\t</Nested>",
        "</Root>",
        "",
      ].join("\n"),
    );
    expect(textOf(parseXml(xml), "Name")).toBe("R & D <1>");
  });
});
