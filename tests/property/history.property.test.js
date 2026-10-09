// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";
import { ProgrammeController } from "../../src/model/controller.js";
import { loadFixture, scheduledProgramme } from "../support/builders.js";
import { RUNS } from "../support/arbitraries.js";

/**
 * Model-based test of transactions and undo/redo. The model is the list of
 * committed snapshots plus a cursor; every command must leave the controller
 * equal to the model's current snapshot.
 */

const TASK_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

class Model {
  constructor(initial) {
    this.snapshots = [initial];
    this.cursor = 0;
  }

  get current() {
    return this.snapshots[this.cursor];
  }

  commit(snapshot) {
    this.snapshots = [...this.snapshots.slice(0, this.cursor + 1), snapshot];
    this.cursor += 1;
  }
}

/** Runs an edit and records it in the model when it committed. */
class EditCommand {
  constructor(label, edit) {
    this.label = label;
    this.edit = edit;
  }

  check() {
    return true;
  }

  run(model, controller) {
    let committed = false;
    const unsubscribe = controller.on("change", () => {
      committed = true;
    });
    this.edit(controller);
    unsubscribe();
    if (committed) model.commit(controller.toJSON());
    expect(controller.toJSON()).toEqual(model.current);
    expect(controller.canUndo()).toBe(model.cursor > 0);
  }

  toString() {
    return this.label;
  }
}

class UndoCommand {
  check(model) {
    return model.cursor > 0;
  }

  run(model, controller) {
    controller.undo();
    model.cursor -= 1;
    expect(controller.toJSON()).toEqual(model.current);
    expect(controller.canRedo()).toBe(true);
  }

  toString() {
    return "undo";
  }
}

class RedoCommand {
  check(model) {
    return model.cursor < model.snapshots.length - 1;
  }

  run(model, controller) {
    controller.redo();
    model.cursor += 1;
    expect(controller.toJSON()).toEqual(model.current);
  }

  toString() {
    return "redo";
  }
}

const taskId = fc.constantFrom(...TASK_IDS);
const shift = fc.integer({ min: -3, max: 5 });

const commands = [
  fc.tuple(taskId, shift).map(
    ([id, days]) =>
      new EditCommand(`move(${id}, ${days})`, (controller) => {
        const task = controller.getTask(id);
        if (!task) return;
        controller.updateTask(
          id,
          { start: controller.calendar.addWorkingDays(task.start, days || 1) },
          { cause: "drag" },
        );
      }),
  ),
  fc
    .tuple(taskId, fc.integer({ min: 1, max: 8 }))
    .map(
      ([id, duration]) =>
        new EditCommand(`resize(${id}, ${duration})`, (controller) =>
          controller.updateTask(id, { duration }),
        ),
    ),
  fc.nat(99).map(
    (index) =>
      new EditCommand(`add(N${index})`, (controller) =>
        controller.addTask({
          id: `N${index}`,
          name: `New ${index}`,
          start: "2026-11-10",
          duration: 2,
        }),
      ),
  ),
  fc
    .tuple(taskId, fc.boolean())
    .map(
      ([id, cascade]) =>
        new EditCommand(`remove(${id})`, (controller) => controller.removeTask(id, { cascade })),
    ),
  fc
    .tuple(taskId, taskId, fc.constantFrom("FS", "SS", "FF", "SF"))
    .map(
      ([from, to, type]) =>
        new EditCommand(`link(${from}->${to} ${type})`, (controller) =>
          controller.addLink({ from, to, type }),
        ),
    ),
  fc
    .nat(10)
    .map(
      (index) =>
        new EditCommand(`unlink(l${index + 1})`, (controller) =>
          controller.removeLink(`l${index + 1}`),
        ),
    ),
  fc
    .tuple(taskId, fc.nat(1_000_000))
    .map(
      ([id, pence]) =>
        new EditCommand(`cost(${id}, ${pence})`, (controller) =>
          controller.updateTask(id, { fields: { cost: pence } }),
        ),
    ),
  fc.tuple(taskId, taskId).map(
    ([first, second]) =>
      new EditCommand(`batch(${first}, ${second})`, (controller) =>
        controller.batch(() => {
          controller.updateTask(first, { name: `Batched ${first}` });
          controller.updateTask(second, { duration: 2 });
        }),
      ),
  ),
  fc.tuple(taskId, fc.string({ maxLength: 8 })).map(
    ([id, name]) =>
      new EditCommand(`patch(${id})`, (controller) => {
        if (controller.getTask(id))
          controller.applyPatch({ tasks: { update: [{ id, name: `Server ${name}` }] } });
      }),
  ),
  fc.constant(new UndoCommand()),
  fc.constant(new RedoCommand()),
];

test.prop([fc.commands(commands, { maxCommands: 30 })], {
  numRuns: Math.max(50, Math.floor(RUNS / 2)),
})(
  "every command matches the snapshot model; undoing everything restores the start",
  (sequence) => {
    const initial = scheduledProgramme(loadFixture("programmes/cpm-n1.json"));
    const controller = new ProgrammeController({
      data: initial,
      fields: [{ key: "cost", type: "currency", rollup: "sum" }],
    });
    const model = new Model(controller.toJSON());
    fc.modelRun(() => ({ model, real: controller }), sequence);
    while (controller.undo()) model.cursor -= 1;
    expect(controller.toJSON()).toEqual(model.snapshots[0]);
    while (controller.redo()) model.cursor += 1;
    expect(controller.toJSON()).toEqual(model.snapshots.at(-1));
  },
);
