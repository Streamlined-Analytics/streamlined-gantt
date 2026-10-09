// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * A small, strict XML reader and writer for MSPDI. It runs anywhere (browser,
 * worker, Node) without DOMParser, and it is safe by construction: DOCTYPE
 * declarations are rejected, so external entities (XXE) and entity expansion
 * attacks are impossible, and only the five predefined entities and numeric
 * character references are decoded.
 *
 * @module io/xml
 */

/**
 * @typedef {object} XmlElement
 * @property {string} name local name (namespace prefix removed)
 * @property {Record<string, string>} attributes
 * @property {XmlElement[]} children
 * @property {string} text concatenated character data of this element
 */

/** Thrown for malformed or unsafe XML, with the position of the problem. */
export class MspdiParseError extends Error {
  /**
   * @param {string} message
   * @param {number} line 1-based
   * @param {number} column 1-based
   */
  constructor(message, line, column) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "MspdiParseError";
    this.line = line;
    this.column = column;
  }
}

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/**
 * @param {string} text
 * @param {(message: string) => never} fail
 * @returns {string}
 */
function decode(text, fail) {
  if (/&(?!(#x[0-9a-fA-F]+|#\d+|\w+);)/.test(text)) fail("Unescaped & in text");
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);?/g, (match, entity) => {
    if (!match.endsWith(";")) fail(`Unterminated entity "${match}"`);
    if (entity[0] !== "#") {
      if (!(entity in ENTITIES)) fail(`Unknown entity "&${entity};"`);
      return ENTITIES[entity];
    }
    const code =
      entity[1] === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff) fail(`Invalid character reference "${match}"`);
    return String.fromCodePoint(code);
  });
}

/**
 * Parses an XML document into a tree of elements: a single forward scan,
 * one markup construct at a time.
 * @param {string} source
 * @returns {XmlElement} the root element
 * @throws {MspdiParseError}
 */
export function parseXml(source) {
  let position = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {XmlElement|null} */
  let root = null;
  /** @type {(message: string) => never} */
  const fail = (message) => {
    const before = source.slice(0, position);
    throw new MspdiParseError(
      message,
      before.split("\n").length,
      position - before.lastIndexOf("\n"),
    );
  };
  const top = () => stack[stack.length - 1];
  /** @param {string} text */
  const addText = (text) => {
    if (stack.length) top().text += decode(text, fail);
    else if (text.trim()) fail("Text outside the root element");
  };
  const cdata = () => {
    const end = source.indexOf("]]>", position);
    if (end === -1) fail("Unterminated CDATA section");
    if (!stack.length) fail("CDATA outside the root element");
    top().text += source.slice(position + 9, end);
    position = end + 3;
  };
  const closeTag = () => {
    const end = source.indexOf(">", position);
    if (end === -1) fail("Unterminated closing tag");
    const name = localName(source.slice(position + 2, end).trim());
    if (stack.pop()?.name !== name) fail(`Unexpected closing tag </${name}>`);
    position = end + 1;
  };
  const openTag = () => {
    const tagEnd = findTagEnd(source, position, fail);
    const raw = source.slice(position + 1, tagEnd);
    const selfClosing = raw.endsWith("/");
    const element = parseTag(selfClosing ? raw.slice(0, -1) : raw, fail);
    if (stack.length) top().children.push(element);
    else if (root) fail("More than one root element");
    else root = element;
    if (!selfClosing) stack.push(element);
    position = tagEnd + 1;
  };
  const markup = () => {
    if (source.startsWith("<?", position))
      position = skipPast(source, "?>", position, fail, "processing instruction");
    else if (source.startsWith("<!--", position))
      position = skipPast(source, "-->", position, fail, "comment");
    else if (source.startsWith("<![CDATA[", position)) cdata();
    else if (source.startsWith("<!", position))
      fail("DOCTYPE and other declarations are not allowed");
    else if (source.startsWith("</", position)) closeTag();
    else openTag();
  };
  while (position < source.length) {
    const next = source.indexOf("<", position);
    if (next === -1) {
      addText(source.slice(position));
      break;
    }
    if (next > position) addText(source.slice(position, next));
    position = next;
    markup();
  }
  if (stack.length) fail(`Unclosed element <${top().name}>`);
  if (!root) fail("No root element");
  return /** @type {XmlElement} */ (root);
}

/**
 * @param {string} source
 * @param {string} terminator
 * @param {number} position
 * @param {(message: string) => never} fail
 * @param {string} what
 * @returns {number}
 */
function skipPast(source, terminator, position, fail, what) {
  const end = source.indexOf(terminator, position);
  if (end === -1) fail(`Unterminated ${what}`);
  return end + terminator.length;
}

/**
 * The index of the ">" that ends a start tag, skipping quoted attribute values.
 * @param {string} source
 * @param {number} position
 * @param {(message: string) => never} fail
 * @returns {number}
 */
function findTagEnd(source, position, fail) {
  let quote = "";
  for (let index = position + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
    else if (character === "<") break;
  }
  return fail("Unterminated start tag");
}

/**
 * @param {string} raw
 * @param {(message: string) => never} fail
 * @returns {XmlElement}
 */
function parseTag(raw, fail) {
  const match = /^([^\s/>]+)/.exec(raw);
  if (!match) fail("Missing element name");
  /** @type {Record<string, string>} */
  const attributes = {};
  const pattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let attribute;
  while ((attribute = pattern.exec(raw.slice(match[1].length)))) {
    attributes[attribute[1]] = decode(attribute[3] ?? attribute[4] ?? "", fail);
  }
  return { name: localName(match[1]), attributes, children: [], text: "" };
}

/**
 * @param {string} qualified
 * @returns {string}
 */
function localName(qualified) {
  const colon = qualified.indexOf(":");
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

/**
 * The first child element with a name.
 * @param {XmlElement|undefined} element
 * @param {string} name
 * @returns {XmlElement|undefined}
 */
export function child(element, name) {
  return element?.children.find((candidate) => candidate.name === name);
}

/**
 * All child elements with a name.
 * @param {XmlElement|undefined} element
 * @param {string} name
 * @returns {XmlElement[]}
 */
export function children(element, name) {
  return element?.children.filter((candidate) => candidate.name === name) ?? [];
}

/**
 * The trimmed text of a named child, or undefined.
 * @param {XmlElement|undefined} element
 * @param {string} name
 * @returns {string|undefined}
 */
export function textOf(element, name) {
  const found = child(element, name);
  return found ? found.text.trim() : undefined;
}

/**
 * Code points outside the XML 1.0 `Char` production: C0 controls other than
 * tab, line feed and carriage return, lone surrogates, U+FFFE and U+FFFF.
 */
/* eslint-disable-next-line no-control-regex */
const ILLEGAL_XML = /[\0-\b\v\f\x0e-\x1f\ud800-\udfff\ufffe\uffff]/gu;

/**
 * Escapes text for XML, dropping characters XML 1.0 cannot carry (see
 * ADR-0012), so the document is always well-formed. Carriage returns are
 * written as `&#13;`, because an XML parser turns a literal one into a line
 * feed.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeXml(value) {
  return String(value)
    .replace(ILLEGAL_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;");
}

/**
 * `[name, value]` pairs for {@link XmlWriter}; loosely typed because the
 * nesting is arbitrary.
 * @typedef {any[]} XmlChildren
 */

/**
 * Builds indented XML. Children are `[name, value]` pairs; a value is text,
 * a number, or an array of further pairs. Undefined values are skipped.
 */
export class XmlWriter {
  constructor() {
    /** @type {string[]} */
    this.lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'];
  }

  /**
   * @param {string} name
   * @param {unknown} value
   * @param {number} depth
   * @param {string} [attributes]
   */
  write(name, value, depth, attributes = "") {
    if (value === undefined || value === null) return;
    const indent = "\t".repeat(depth);
    if (!Array.isArray(value)) {
      this.lines.push(`${indent}<${name}${attributes}>${escapeXml(value)}</${name}>`);
      return;
    }
    if (value.length === 0) {
      this.lines.push(`${indent}<${name}${attributes}/>`);
      return;
    }
    this.lines.push(`${indent}<${name}${attributes}>`);
    for (const [childName, childValue] of value) this.write(childName, childValue, depth + 1);
    this.lines.push(`${indent}</${name}>`);
  }

  /** @returns {string} */
  toString() {
    return `${this.lines.join("\n")}\n`;
  }
}
