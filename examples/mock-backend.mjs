// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { readFileSync } from "node:fs";
import {
  isMilestone,
  isoWeekday,
  resolveLeafDates,
  schedule,
  schedulingCalendar,
  toDay,
  toISO,
} from "../src/engine/index.js";

/**
 * Development-only mock programme API for the integration examples. It plays
 * a contractor's backend with two business rules, so both integration styles
 * can show approve, reject and correct:
 *
 * - **reject**: nothing may finish after the Christmas shutdown starts (18 Dec 2026);
 * - **correct**: no task may start on a Friday; the server moves it to the
 *   Monday and reschedules the successors with the same engine.
 *
 * Routes (`:job` is any id; each job starts as a fresh copy of flat-roof.json):
 *
 * - `GET  /api/jobs/:job/programme` the stored programme;
 * - `POST /api/jobs/:job/changes` htmx save-back after a `gantt:change`
 *   (form field `changes`). Replies with an `HX-Trigger` header carrying a
 *   `gantt:patch` that reverts or corrects, and a `save-status` message;
 * - `PATCH /api/jobs/:job/tasks/:id` approval before an edit commits
 *   (`waitUntil`): 204 approves, 409 rejects, 200 with a changeset corrects.
 */

const SHUTDOWN = "2026-12-18";
const SEED = readFileSync(new URL("./data/flat-roof.json", import.meta.url), "utf8");
/** @type {Map<string, any>} */
const jobs = new Map();

/** @param {string} job */
function programmeFor(job) {
  if (!jobs.has(job)) jobs.set(job, JSON.parse(SEED));
  return jobs.get(job);
}

/** Runs the scheduler and writes its dates into the programme. */
function reschedule(programme) {
  const result = schedule({
    tasks: programme.tasks,
    links: programme.links ?? [],
    calendar: schedulingCalendar(programme),
    dataDate: programme.dataDate ?? null,
    mode: "propagate",
  });
  for (const change of result.changed) {
    const task = programme.tasks.find((candidate) => candidate.id === change.id);
    Object.assign(task, { start: change.start, finish: change.finish, duration: change.duration });
  }
  return result;
}

/**
 * The first rule the changed tasks break: a rejection, a correction (applied
 * to `programme` and rescheduled), or null when the change is fine.
 * @param {any} programme
 * @param {Set<string>} changed ids of tasks this request moved
 */
function review(programme, changed) {
  const touched = programme.tasks.filter((task) => changed.has(task.id));
  const late = touched.find((task) => task.finish && task.finish > SHUTDOWN);
  if (late)
    return {
      outcome: "rejected",
      message: `"${late.name}" would finish after the Christmas shutdown`,
    };
  const friday = touched.find(
    (task) => task.start && !isMilestone(task) && isoWeekday(toDay(task.start)) === 5,
  );
  if (!friday) return null;
  friday.start = toISO(toDay(friday.start) + 3);
  delete friday.finish;
  friday.finish = toISO(resolveLeafDates(friday, schedulingCalendar(programme)).finish);
  reschedule(programme);
  return {
    outcome: "corrected",
    message: `"${friday.name}" moved to Monday: no Friday starts on this site`,
  };
}

/** Ids of tasks whose record differs between two programmes. */
function changedIds(before, after) {
  const old = new Map(before.tasks.map((task) => [task.id, JSON.stringify(task)]));
  return new Set(
    after.tasks.filter((task) => old.get(task.id) !== JSON.stringify(task)).map((task) => task.id),
  );
}

/** Full task records in `after` that differ from `before`, as a changeset. */
function changesetBetween(before, after) {
  const old = new Map(before.tasks.map((task) => [task.id, JSON.stringify(task)]));
  const update = after.tasks.filter((task) => old.get(task.id) !== JSON.stringify(task));
  return { tasks: { update } };
}

/** Applies a `gantt:change` payload's task changes to the stored copy. */
function applyChanges(programme, changes) {
  const { added = [], updated = [], removed = [] } = changes.tasks ?? {};
  const removedIds = new Set(removed.map((task) => task.id));
  programme.tasks = programme.tasks.filter((task) => !removedIds.has(task.id));
  for (const entry of updated) {
    const index = programme.tasks.findIndex((task) => task.id === entry.id);
    if (index >= 0) programme.tasks[index] = entry.new;
  }
  programme.tasks.push(...added);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body === undefined ? "" : JSON.stringify(body));
}

/** htmx save-back: the edit is already on screen; reply with a patch when it must change. */
async function saveChanges(request, response, job) {
  const form = new URLSearchParams(await readBody(request));
  const changes = JSON.parse(form.get("changes") ?? "{}");
  const target = form.get("target") ?? undefined;
  const before = structuredClone(programmeFor(job));
  const proposed = structuredClone(before);
  applyChanges(proposed, changes);
  const clientView = structuredClone(proposed);
  const verdict = review(proposed, changedIds(before, proposed));
  if (verdict?.outcome === "rejected") {
    const revert = changesetBetween(clientView, before);
    return send(response, 200, verdict, {
      "HX-Trigger": JSON.stringify({
        "gantt:patch": { target, changes: revert },
        "save-status": verdict,
      }),
    });
  }
  jobs.set(job, proposed);
  const status = verdict ?? { outcome: "saved", message: "Saved" };
  const events = { "save-status": status };
  if (verdict) events["gantt:patch"] = { target, changes: changesetBetween(clientView, proposed) };
  send(response, 200, status, { "HX-Trigger": JSON.stringify(events) });
}

/** fetch approval: the edit waits for this answer before it commits. */
async function approveTask(request, response, job, id) {
  const { task } = JSON.parse(await readBody(request));
  const before = programmeFor(job);
  const proposed = structuredClone(before);
  const index = proposed.tasks.findIndex((candidate) => candidate.id === id);
  if (index < 0 || task?.id !== id) return send(response, 404, { message: `Unknown task "${id}"` });
  proposed.tasks[index] = task;
  reschedule(proposed);
  const verdict = review(proposed, changedIds(before, proposed));
  if (verdict?.outcome === "rejected") return send(response, 409, verdict);
  jobs.set(job, proposed);
  if (!verdict) return send(response, 204);
  send(response, 200, { ...changesetBetween(before, proposed), message: verdict.message });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {URL} url
 */
export async function handleApi(request, response, url) {
  const [, , resource, job, collection, id] = url.pathname.split("/");
  try {
    if (resource !== "jobs" || !job) return send(response, 404, { message: "Not found" });
    if (request.method === "GET" && collection === "programme")
      return send(response, 200, programmeFor(job));
    if (request.method === "POST" && collection === "changes")
      return await saveChanges(request, response, job);
    if (request.method === "PATCH" && collection === "tasks" && id)
      return await approveTask(request, response, job, id);
    send(response, 404, { message: "Not found" });
  } catch (error) {
    send(response, 400, { message: String(error?.message ?? error) });
  }
}
