// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Task hierarchy and dependency-graph helpers. Links that touch a summary are
 * expanded to every leaf task beneath it, which is how MS Project and Asta
 * treat summary logic, and the scheduler only ever sees leaf-to-leaf edges.
 *
 * @module engine/graph
 */

/**
 * @typedef {object} Edge
 * @property {string} linkId
 * @property {string} from leaf task id
 * @property {string} to leaf task id
 * @property {"FS"|"SS"|"FF"|"SF"} type
 * @property {number} lag
 */

/**
 * @typedef {object} Hierarchy
 * @property {Map<string|null, string[]>} childrenOf children in data order; `null` holds the roots
 * @property {Map<string, string|null>} parentOf
 */

/**
 * @param {{id: string, parent?: string|null}[]} tasks
 * @returns {Hierarchy}
 */
export function buildHierarchy(tasks) {
  const ids = new Set(tasks.map((task) => task.id));
  /** @type {Map<string|null, string[]>} */
  const childrenOf = new Map([[null, []]]);
  /** @type {Map<string, string|null>} */
  const parentOf = new Map();
  for (const task of tasks) {
    const parent = task.parent && ids.has(task.parent) ? task.parent : null;
    parentOf.set(task.id, parent);
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(task.id);
  }
  return { childrenOf, parentOf };
}

/**
 * @param {string} id
 * @param {Hierarchy} hierarchy
 * @returns {boolean}
 */
export function hasChildren(id, hierarchy) {
  return (hierarchy.childrenOf.get(id)?.length ?? 0) > 0;
}

/**
 * Leaf tasks at or beneath `id` (a leaf returns itself).
 * @param {string} id
 * @param {Hierarchy} hierarchy
 * @returns {string[]}
 */
export function leavesOf(id, hierarchy) {
  const leaves = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    const children = hierarchy.childrenOf.get(current);
    if (!children?.length) {
      leaves.push(current);
      continue;
    }
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return leaves;
}

/**
 * Ancestors of a task, nearest first.
 * @param {string} id
 * @param {Hierarchy} hierarchy
 * @returns {string[]}
 */
export function ancestorsOf(id, hierarchy) {
  const ancestors = [];
  let current = hierarchy.parentOf.get(id) ?? null;
  while (current !== null && !ancestors.includes(current)) {
    ancestors.push(current);
    current = hierarchy.parentOf.get(current) ?? null;
  }
  return ancestors;
}

/**
 * Expands links to leaf-to-leaf edges.
 * @param {{id: string, parent?: string|null}[]} tasks
 * @param {{id: string, from: string, to: string, type?: string, lag?: number}[]} links
 * @param {Hierarchy} [hierarchy]
 * @returns {Edge[]}
 */
export function expandLinks(tasks, links, hierarchy = buildHierarchy(tasks)) {
  /** @type {Edge[]} */
  const edges = [];
  for (const link of links) {
    const type = /** @type {Edge["type"]} */ (link.type ?? "FS");
    const lag = link.lag ?? 0;
    for (const from of leavesOf(link.from, hierarchy)) {
      for (const to of leavesOf(link.to, hierarchy)) {
        edges.push({ linkId: link.id, from, to, type, lag });
      }
    }
  }
  return edges;
}

/**
 * @param {string[]} nodes
 * @param {Edge[]} edges
 * @returns {{order: string[], blocked: string[]}} `blocked` is non-empty when there is a cycle
 */
export function topologicalOrder(nodes, edges) {
  /** @type {Map<string, number>} */
  const inDegree = new Map(nodes.map((node) => [node, 0]));
  /** @type {Map<string, string[]>} */
  const successors = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) {
    if (!inDegree.has(edge.from) || !inDegree.has(edge.to)) continue;
    inDegree.set(edge.to, inDegree.get(edge.to) + 1);
    successors.get(edge.from).push(edge.to);
  }
  const queue = nodes.filter((node) => inDegree.get(node) === 0);
  const order = [];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head];
    order.push(node);
    for (const next of successors.get(node)) {
      const remaining = inDegree.get(next) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  const blocked = nodes.filter((node) => inDegree.get(node) > 0);
  return { order, blocked };
}

/**
 * Finds one dependency cycle, returned as the task ids along it, or null.
 * @param {{id: string, parent?: string|null}[]} tasks
 * @param {{id: string, from: string, to: string, type?: string, lag?: number}[]} links
 * @returns {string[]|null}
 */
export function findCycle(tasks, links) {
  const hierarchy = buildHierarchy(tasks);
  const edges = expandLinks(tasks, links, hierarchy);
  const leaves = tasks.map((task) => task.id).filter((id) => !hasChildren(id, hierarchy));
  const { blocked } = topologicalOrder(leaves, edges);
  if (!blocked.length) return null;
  return traceCycle(new Set(blocked), edges);
}

/**
 * Walks forward from a blocked node until a node repeats, giving a concrete cycle.
 * @param {Set<string>} blocked
 * @param {Edge[]} edges
 * @returns {string[]}
 */
function traceCycle(blocked, edges) {
  /** @type {Map<string, string>} */
  const next = new Map();
  for (const edge of edges) {
    const bothBlocked = blocked.has(edge.from) && blocked.has(edge.to);
    if (bothBlocked && !next.has(edge.to)) next.set(edge.to, edge.from);
  }
  const path = [];
  const seen = new Map();
  let current = blocked.values().next().value;
  while (!seen.has(current)) {
    seen.set(current, path.length);
    path.push(current);
    current = next.get(current);
  }
  return [current, ...path.slice(seen.get(current)).reverse()];
}

/**
 * True when adding `link` would close a dependency cycle.
 * @param {{id: string, parent?: string|null}[]} tasks
 * @param {{id: string, from: string, to: string, type?: string, lag?: number}[]} links
 * @param {{from: string, to: string, type?: string, lag?: number}} link
 * @returns {boolean}
 */
export function wouldCreateCycle(tasks, links, link) {
  return findCycle(tasks, [...links, { id: "\u0000candidate", ...link }]) !== null;
}
