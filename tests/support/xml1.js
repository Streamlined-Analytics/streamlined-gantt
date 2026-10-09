// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { validateXML } from "xmllint-wasm";

/**
 * Helpers for checking that exported XML is XML 1.0 a strict parser accepts.
 * Our own reader (`io/xml.js`) is lenient about characters, so tests also run
 * libxml2 (compiled to WebAssembly) as an independent judge.
 *
 * @module tests/support/xml1
 */

/**
 * One sample of each class of code point outside the XML 1.0 `Char`
 * production, plus a carriage return, which is legal but which a parser turns
 * into a line feed unless it is written as a character reference.
 * @type {[string, string][]}
 */
export const XML_ILLEGAL_CLASSES = [
  ["U+FFFE", "￾"],
  ["U+FFFF", "￿"],
  ["NUL", "\u0000"],
  [
    "C0 controls (U+0001-U+0008, U+000B, U+000C, U+000E-U+001F)",
    "\u0001\u0008\u000b\u000c\u000e\u001f",
  ],
  ["a lone high surrogate", "\ud800"],
  ["a lone low surrogate", "\udfff"],
  ["a reversed surrogate pair", "\udc00\ud800"],
  ["a carriage return", "\r"],
  ["everything at once, beside legal astral text", "\u{1F3D7}￾\u0001\ud800\r￿"],
];

/* eslint-disable-next-line no-control-regex */
const NOT_XML_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|\p{Cs}/gu;

/**
 * Code points in `text` that XML 1.0 forbids, as `U+XXXX` strings.
 * @param {string} text
 * @returns {string[]}
 */
export function illegalXmlCharacters(text) {
  return [...text.matchAll(NOT_XML_CHAR)].map(
    ([character]) =>
      `U+${/** @type {number} */ (character.codePointAt(0)).toString(16).toUpperCase().padStart(4, "0")}`,
  );
}

/**
 * Fails unless libxml2 parses `xml` as a well-formed XML 1.0 document.
 * @param {string} xml
 * @returns {Promise<void>}
 */
export async function assertWellFormedXml1(xml) {
  const result = await validateXML({ xml: [{ fileName: "export.xml", contents: xml }] });
  if (!result.valid) {
    throw new Error(`libxml2 rejected the XML: ${result.errors.map((e) => e.message).join("; ")}`);
  }
}
