import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REMINDER_MESSAGE,
  createReminderChecker,
} from "../src/reminder.ts";

function at(hours: number, minutes: number, day = 15): Date {
  return new Date(2026, 0, day, hours, minutes, 0, 0);
}

function setup(start: Date) {
  let current = start;
  const notifications: Array<{ message: string; type?: string }> = [];
  const checker = createReminderChecker({
    now: () => current,
    notify: (message, type) => notifications.push({ message, type }),
  });
  return {
    checker,
    notifications,
    setNow: (next: Date) => {
      current = next;
    },
  };
}

describe("createReminderChecker", () => {
  it("emits a reminder inside the window and reports it", () => {
    const { checker, notifications } = setup(at(0, 30));

    assert.equal(checker.check(), true);
    assert.deepEqual(notifications, [
      { message: DEFAULT_REMINDER_MESSAGE, type: "info" },
    ]);
    assert.equal(checker.lastRemindedDayKey(), "2026-01-15");
  });

  it("does not emit twice on the same local day", () => {
    const { checker, notifications, setNow } = setup(at(0, 30));

    assert.equal(checker.check(), true);
    setNow(at(3, 0));
    assert.equal(checker.check(), false);
    setNow(at(5, 59));
    assert.equal(checker.check(), false);

    assert.equal(notifications.length, 1);
    assert.equal(checker.lastRemindedDayKey(), "2026-01-15");
  });

  it("emits again after midnight on the next local day", () => {
    const { checker, notifications, setNow } = setup(at(0, 30));

    assert.equal(checker.check(), true);
    setNow(at(0, 30, 16));
    assert.equal(checker.check(), true);

    assert.equal(notifications.length, 2);
    assert.equal(checker.lastRemindedDayKey(), "2026-01-16");
  });

  it("does not emit outside the window", () => {
    const { checker, notifications, setNow } = setup(at(23, 59));

    assert.equal(checker.check(), false);
    setNow(at(12, 0));
    assert.equal(checker.check(), false);
    setNow(at(6, 0));
    assert.equal(checker.check(), false);

    assert.equal(notifications.length, 0);
    assert.equal(checker.lastRemindedDayKey(), null);
  });

  it("uses an injected message when provided", () => {
    let current = at(1, 0);
    const notifications: string[] = [];
    const checker = createReminderChecker({
      now: () => current,
      message: "custom reminder",
      notify: (message) => notifications.push(message),
    });

    assert.equal(checker.check(), true);
    assert.deepEqual(notifications, ["custom reminder"]);
  });
});
