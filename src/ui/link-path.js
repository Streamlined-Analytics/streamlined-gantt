// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { px } from "./dom.js";

/**
 * Orthogonal routing for dependency arrows. Pure geometry: given the left and
 * right edges and vertical centre of both ends, returns an SVG path that leaves
 * the predecessor from the edge its link type names and enters the successor
 * at the edge its type names, with the arrow head on the last segment.
 *
 * - FS: predecessor's right edge to successor's left edge
 * - SS: left edge to left edge
 * - FF: right edge to right edge
 * - SF: left edge to right edge
 *
 * @module ui/link-path
 */

/**
 * @typedef {object} BarGeometry
 * @property {number} left
 * @property {number} right
 * @property {number} y vertical centre
 */

/**
 * @param {"FS"|"SS"|"FF"|"SF"} type
 * @param {BarGeometry} from predecessor
 * @param {BarGeometry} to successor
 * @param {{stub?: number, rowHeight?: number}} [options]
 * @returns {string}
 */
export function linkPath(type, from, to, options = {}) {
  const stub = options.stub ?? 8;
  const rowHeight = options.rowHeight ?? 32;
  const direction = to.y >= from.y ? 1 : -1;
  const between = from.y + (direction * rowHeight) / 2;
  const leavesRight = type === "FS" || type === "FF";
  const entersLeft = type === "FS" || type === "SS";
  const startX = leavesRight ? from.right : from.left;
  const endX = entersLeft ? to.left : to.right;
  const exitX = leavesRight ? startX + stub : startX - stub;
  const approachX = entersLeft ? endX - stub : endX + stub;
  const exitTowardsTarget = leavesRight ? exitX <= approachX : exitX >= approachX;
  const sameDirection = leavesRight === entersLeft;
  let points;
  if (sameDirection && exitTowardsTarget) {
    points = [
      [startX, from.y],
      [exitX, from.y],
      [exitX, to.y],
      [endX, to.y],
    ];
  } else if (!sameDirection) {
    const outer = leavesRight ? Math.max(exitX, approachX) : Math.min(exitX, approachX);
    points = [
      [startX, from.y],
      [outer, from.y],
      [outer, to.y],
      [endX, to.y],
    ];
  } else {
    points = [
      [startX, from.y],
      [exitX, from.y],
      [exitX, between],
      [approachX, between],
      [approachX, to.y],
      [endX, to.y],
    ];
  }
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${px(x)} ${px(y)}`).join(" ");
}
