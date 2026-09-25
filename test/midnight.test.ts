import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isWithinReminderWindow,
  reminderDayKey,
  shouldRemind,
} from "../src/midnight.ts";

/**
 * Build a Date at a local wall-clock time. Using the multi-argument Date
 * constructor keeps the tests timezone-independent: `getHours()` etc. read the
 * same local clock that this helper writes.
 */
function at(hours: number, minutes: number, day = 15): Date {
  return new Date(2026, 0, day, hours, minutes, 0, 0);
}

describe("isWithinReminderWindow", () => {
  it("returns false at 23:59 (outside the window)", () => {
    assert.equal(isWithinReminderWindow(at(23, 59)), false);
  });

  it("returns true at 00:00 (start is inclusive)", () => {
    assert.equal(isWithinReminderWindow(at(0, 0)), true);
  });

  it("returns true at 05:59 (inside the window)", () => {
    assert.equal(isWithinReminderWindow(at(5, 59)), true);
  });

  it("returns false at 06:00 (end is exclusive)", () => {
    assert.equal(isWithinReminderWindow(at(6, 0)), false);
  });

  it("returns true at an interior time such as 03:00", () => {
    assert.equal(isWithinReminderWindow(at(3, 0)), true);
  });

  it("returns false during the day such as 12:00", () => {
    assert.equal(isWithinReminderWindow(at(12, 0)), false);
  });

  it("returns true one second inside each edge", () => {
    assert.equal(isWithinReminderWindow(new Date(2026, 0, 15, 0, 0, 1)), true);
    assert.equal(isWithinReminderWindow(new Date(2026, 0, 15, 5, 59, 59)), true);
  });
});

describe("reminderDayKey", () => {
  it("is stable for two different times on the same local day", () => {
    assert.equal(reminderDayKey(at(0, 30)), reminderDayKey(at(23, 30)));
  });

  it("differs across adjacent local days", () => {
    assert.notEqual(reminderDayKey(at(0, 30, 15)), reminderDayKey(at(0, 30, 16)));
  });
});

describe("shouldRemind", () => {
  it("reminds inside the window when there was no previous reminder", () => {
    assert.equal(shouldRemind(at(0, 30), null), true);
  });

  it("does not remind outside the window", () => {
    assert.equal(shouldRemind(at(23, 59), null), false);
    assert.equal(shouldRemind(at(12, 0), null), false);
  });

  it("does not remind at the exclusive 06:00 boundary", () => {
    assert.equal(shouldRemind(at(6, 0), null), false);
  });

  it("does not remind twice on the same local day", () => {
    const first = at(0, 30);
    const lastRemindedDayKey = reminderDayKey(first);

    assert.equal(shouldRemind(at(3, 0), lastRemindedDayKey), false);
    assert.equal(shouldRemind(at(5, 59), lastRemindedDayKey), false);
  });

  it("reminds again after midnight on the next local day", () => {
    const previousDayKey = reminderDayKey(at(0, 30, 15));

    assert.equal(shouldRemind(at(0, 30, 16), previousDayKey), true);
  });
});
