// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Naive day-walking calendar oracle used for differential testing. It uses
 * Date.UTC day numbers and walks one day at a time, sharing no code with
 * src/engine/calendar.js.
 */

const MS_PER_DAY = 86_400_000;

export function toDayNumber(iso) {
  return (
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) /
    MS_PER_DAY
  );
}

export function toIsoString(dayNumber) {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

function expand(exceptions = []) {
  const days = new Set();
  for (const exception of exceptions) {
    if (exception.date) {
      days.add(toDayNumber(exception.date));
      continue;
    }
    for (let day = toDayNumber(exception.from); day <= toDayNumber(exception.to); day += 1)
      days.add(day);
  }
  return days;
}

export function makeOracle(definition) {
  const workWeek = new Set(definition.workWeek ?? [1, 2, 3, 4, 5]);
  const nonWorking = expand(definition.nonWorking);
  const working = expand(definition.working);
  const isWorkingDay = (day) => {
    if (working.has(day)) return true;
    if (nonWorking.has(day)) return false;
    const weekday = ((new Date(day * MS_PER_DAY).getUTCDay() + 6) % 7) + 1;
    return workWeek.has(weekday);
  };
  return {
    isWorking: (iso) => isWorkingDay(toDayNumber(iso)),
    addWorkingDays(iso, count) {
      let day = toDayNumber(iso);
      const step = Math.sign(count);
      let remaining = Math.abs(count);
      while (remaining > 0) {
        day += step;
        if (isWorkingDay(day)) remaining -= 1;
      }
      return toIsoString(day);
    },
    workingDaysBetween(startIso, finishIso) {
      let count = 0;
      for (let day = toDayNumber(startIso); day <= toDayNumber(finishIso); day += 1) {
        if (isWorkingDay(day)) count += 1;
      }
      return count;
    },
    nextWorkingDay(iso) {
      let day = toDayNumber(iso);
      while (!isWorkingDay(day)) day += 1;
      return toIsoString(day);
    },
  };
}
