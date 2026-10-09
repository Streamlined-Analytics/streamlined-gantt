// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Small DOM helpers. User-supplied strings are always inserted as text.
 * Markup is only accepted wrapped in {@link trustedHTML}, which makes every
 * opt-in explicit and greppable; this module is the only place in the library
 * allowed to assign `innerHTML`.
 *
 * @module ui/dom
 */

export const SVG_NS = "http://www.w3.org/2000/svg";

const TRUSTED = Symbol("streamlined-gantt.trustedHTML");

/**
 * Marks a string as trusted HTML. Use only for markup you control: anything
 * built from task names or other user data must be escaped first.
 * @param {string} html
 * @returns {{[TRUSTED]: true, html: string, toString: () => string}}
 */
export function trustedHTML(html) {
  return /** @type {any} */ (
    Object.freeze({ [TRUSTED]: true, html: String(html), toString: () => String(html) })
  );
}

/**
 * @param {unknown} value
 * @returns {value is {html: string}}
 */
export function isTrustedHTML(value) {
  return Boolean(value && typeof value === "object" && value[TRUSTED] === true);
}

/**
 * Fills an element from a template result: a Node is appended, trusted HTML
 * is parsed, and anything else is rendered as text.
 * @param {Element} element
 * @param {unknown} content
 */
export function setContent(element, content) {
  if (content instanceof Node) {
    element.replaceChildren(content);
    return;
  }
  if (isTrustedHTML(content)) {
    element.innerHTML = content.html;
    return;
  }
  element.textContent = content === null || content === undefined ? "" : String(content);
}

/**
 * Creates an HTML element.
 * @param {string} tag
 * @param {Record<string, string|number|boolean|null|undefined>} [attributes]
 * @param {(Node|string)[]} [children]
 * @returns {HTMLElement}
 */
export function html(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  setAttributes(element, attributes);
  element.append(...children);
  return element;
}

/**
 * Creates an SVG element.
 * @param {string} tag
 * @param {Record<string, string|number|boolean|null|undefined>} [attributes]
 * @param {(Node|string)[]} [children]
 * @returns {SVGElement}
 */
export function svg(tag, attributes = {}, children = []) {
  const element = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
  setAttributes(element, attributes);
  element.append(...children);
  return element;
}

/**
 * Sets or removes attributes; `false`, `null` and `undefined` remove.
 * @param {Element} element
 * @param {Record<string, string|number|boolean|null|undefined>} attributes
 */
export function setAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) {
      element.removeAttribute(name);
      continue;
    }
    const text = value === true ? "" : String(value);
    if (element.getAttribute(name) !== text) element.setAttribute(name, text);
  }
}

/**
 * Rounds a pixel value for attributes.
 * @param {number} value
 * @returns {number}
 */
export function px(value) {
  return Math.round(value * 100) / 100;
}
