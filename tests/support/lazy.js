// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Defers building a test fixture until the first test touches it.
 *
 * Mutation testing activates a mutant just before the tests of a file run.
 * Anything computed while the file is being collected (module or describe
 * scope) runs unmutated and turns every mutant it reaches into a "static"
 * mutant, so fixtures that call the engine are built lazily instead.
 *
 * @template {object} T
 * @param {() => T} build
 * @returns {T}
 */
export function lazy(build) {
  let instance;
  const target = () => (instance ??= build());
  return new Proxy(
    {},
    {
      get(_, property) {
        const value = Reflect.get(target(), property);
        return typeof value === "function" ? value.bind(target()) : value;
      },
      has: (_, property) => Reflect.has(target(), property),
      getPrototypeOf: () => Reflect.getPrototypeOf(target()),
      ownKeys: () => Reflect.ownKeys(target()),
      getOwnPropertyDescriptor: (_, property) =>
        Reflect.getOwnPropertyDescriptor(target(), property),
    },
  );
}
