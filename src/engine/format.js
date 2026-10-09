// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toYMD } from "./dates.js";

/**
 * Locale-aware formatting for display only. Dates are formatted from day
 * numbers through `Intl.DateTimeFormat` pinned to UTC, so the viewer's time
 * zone can never move a date. Money arrives as integer minor units.
 *
 * @module engine/format
 */

const dateFormatters = new Map();
const moneyFormatters = new Map();

/**
 * @param {string} locale
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {Intl.DateTimeFormat}
 */
function dateFormatter(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  if (!dateFormatters.has(key)) {
    dateFormatters.set(key, new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }));
  }
  return dateFormatters.get(key);
}

/**
 * Formats a day number, e.g. `formatDate(day, "en-GB")` → "02/11/2026".
 * @param {number} day
 * @param {string} [locale]
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatDate(
  day,
  locale = "en-GB",
  options = { day: "2-digit", month: "2-digit", year: "numeric" },
) {
  const { year, month, day: dayOfMonth } = toYMD(day);
  return dateFormatter(locale, options).format(Date.UTC(year, month - 1, dayOfMonth));
}

/**
 * @param {string} locale
 * @param {string} currency
 * @returns {Intl.NumberFormat}
 */
function moneyFormatter(locale, currency) {
  const key = `${locale}|${currency}`;
  if (!moneyFormatters.has(key)) {
    moneyFormatters.set(key, new Intl.NumberFormat(locale, { style: "currency", currency }));
  }
  return moneyFormatters.get(key);
}

/**
 * Number of minor units per major unit for a currency (100 for GBP, 1 for JPY).
 * @param {string} currency
 * @returns {number}
 */
export function minorUnitScale(currency) {
  const digits = moneyFormatter("en-GB", currency).resolvedOptions().maximumFractionDigits ?? 2;
  return 10 ** digits;
}

/**
 * Formats integer minor units, e.g. `formatMoney(900000)` → "£9,000.00".
 * @param {number} minor
 * @param {{locale?: string, currency?: string}} [options]
 * @returns {string}
 */
export function formatMoney(minor, options = {}) {
  const currency = options.currency ?? "GBP";
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "";
  return moneyFormatter(options.locale ?? "en-GB", currency).format(
    minor / minorUnitScale(currency),
  );
}

/**
 * Parses user input such as "£1,250.50" or "1250.5" into integer minor units.
 * Returns null for empty input and NaN for unparseable input.
 * @param {string} text
 * @param {{currency?: string}} [options]
 * @returns {number|null}
 */
export function parseMoney(text, options = {}) {
  const cleaned = String(text).replace(/[^\d.-]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return Number.NaN;
  const scale = minorUnitScale(options.currency ?? "GBP");
  const digits = Math.round(Math.log10(scale));
  const negative = cleaned.startsWith("-");
  const [whole = "0", fraction = ""] = cleaned.replace("-", "").split(".");
  const paddedFraction = (fraction + "0".repeat(digits)).slice(0, digits);
  const roundUp = fraction.length > digits && Number(fraction[digits]) >= 5 ? 1 : 0;
  const magnitude = Number(whole || "0") * scale + Number(paddedFraction || "0") + roundUp;
  return negative ? -magnitude : magnitude;
}

/**
 * Formats a 0..1 fraction as a percentage, e.g. 0.2956 → "29.6%".
 * @param {number} fraction
 * @param {string} [locale]
 * @returns {string}
 */
export function formatPercent(fraction, locale = "en-GB") {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return "";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
    fraction,
  );
}
