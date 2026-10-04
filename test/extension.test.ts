import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import midnightReminder, { CHECK_INTERVAL_MS } from "../src/extension.ts";
import { DEFAULT_REMINDER_MESSAGE } from "../src/reminder.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

/** Minimal fake of the ExtensionAPI surface this extension uses. */
function createFakePi() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { description?: string; handler: Handler }>();
  const api = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    registerCommand(name: string, options: { description?: string; handler: Handler }) {
      commands.set(name, options);
    },
  };
  return { api: api as unknown as ExtensionAPI, handlers, commands };
}

function createFakeContext(hasUI = true) {
  const notifications: Array<{ message: string; type?: string }> = [];
  const ctx = {
    hasUI,
    ui: {
      notify: (message: string, type?: string) => notifications.push({ message, type }),
    },
  };
  return { ctx, notifications };
}

/** Count the actual reminder notifications (excluding command status messages). */
function reminderCount(notifications: Array<{ message: string }>): number {
  return notifications.filter((n) => n.message === DEFAULT_REMINDER_MESSAGE).length;
}

/** Message of the most recent notification. */
function lastMessage(notifications: Array<{ message: string }>): string {
  return notifications.at(-1)?.message ?? "";
}

describe("midnight reminder extension lifecycle", () => {
  beforeEach(() => {
    mock.timers.enable({
      apis: ["setInterval", "Date"],
      now: new Date(2026, 0, 15, 0, 30, 0).getTime(),
    });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("checks immediately on session_start and keeps polling", async () => {
    const { api, handlers } = createFakePi();
    midnightReminder(api);
    const { ctx, notifications } = createFakeContext();

    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    assert.equal(notifications.length, 1, "immediate check inside the window should notify");

    // Polls continue, but the pure policy dedupes the same local day.
    mock.timers.tick(CHECK_INTERVAL_MS);
    mock.timers.tick(CHECK_INTERVAL_MS);
    assert.equal(notifications.length, 1, "repeated checks must not duplicate reminders");
  });

  it("reminds again on the next local day while polling", async () => {
    const { api, handlers } = createFakePi();
    midnightReminder(api);
    const { ctx, notifications } = createFakeContext();

    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    assert.equal(notifications.length, 1);

    mock.timers.tick(24 * 60 * 60 * 1000);
    assert.equal(notifications.length, 2);
  });

  it("clears the interval on session_shutdown", async () => {
    const { api, handlers } = createFakePi();
    midnightReminder(api);
    const { ctx, notifications } = createFakeContext();

    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    const before = notifications.length;

    await handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    mock.timers.tick(24 * 60 * 60 * 1000);

    assert.equal(notifications.length, before, "no checks should run after cleanup");
  });

  it("registers a manual /bedtime-test command", () => {
    const { api, commands } = createFakePi();
    midnightReminder(api);

    assert.ok(commands.has("bedtime-test"));
    assert.match(commands.get("bedtime-test")?.description ?? "", /reminder/i);
  });
});

describe("/bedtime-test command", () => {
  beforeEach(() => {
    mock.timers.enable({
      apis: ["setInterval", "Date"],
      now: new Date(2026, 0, 15, 0, 30, 0).getTime(),
    });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  /**
   * Start a session at a daytime clock (outside the window) so the immediate
   * `session_start` check does not consume the day before we drive the command.
   */
  async function startAtDaytime() {
    const { api, handlers, commands } = createFakePi();
    midnightReminder(api);
    const { ctx, notifications } = createFakeContext();
    mock.timers.setTime(new Date(2026, 0, 15, 12, 0, 0).getTime());
    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    const command = commands.get("bedtime-test");
    assert.ok(command, "bedtime-test command should be registered");
    return { command, ctx, notifications };
  }

  it("with no argument checks the real clock", async () => {
    const { command, ctx, notifications } = await startAtDaytime();

    mock.timers.setTime(new Date(2026, 0, 15, 1, 0, 0).getTime());
    await command.handler("", ctx);

    // One real reminder plus the command's fired confirmation.
    assert.equal(reminderCount(notifications), 1);
    assert.match(lastMessage(notifications), /fired/i);
  });

  it("fires, dedupes by date, and fires again on a new date", async () => {
    const { command, ctx, notifications } = await startAtDaytime();

    await command.handler("2026-01-15 00:30", ctx);
    assert.equal(reminderCount(notifications), 1);
    assert.match(lastMessage(notifications), /fired/i);

    // Same date, later time inside the window: no second reminder.
    await command.handler("2026-01-15 03:00", ctx);
    assert.equal(reminderCount(notifications), 1);
    assert.match(lastMessage(notifications), /no reminder/i);

    // New calendar day: reminder fires again.
    await command.handler("2026-01-16 00:30", ctx);
    assert.equal(reminderCount(notifications), 2);
    assert.match(lastMessage(notifications), /fired/i);
  });

  it("does not fire outside the window (12:00 and the exclusive 06:00 edge)", async () => {
    const { command, ctx, notifications } = await startAtDaytime();

    await command.handler("2026-01-15 12:00", ctx);
    await command.handler("2026-01-15 06:00", ctx);

    assert.equal(reminderCount(notifications), 0);
    assert.equal(notifications.length, 2);
    for (const notification of notifications) {
      assert.match(notification.message, /no reminder/i);
    }
  });

  it("reports invalid simulated times without checking the clock", async () => {
    const { command, ctx, notifications } = await startAtDaytime();

    await command.handler("not-a-time", ctx);

    assert.equal(reminderCount(notifications), 0);
    assert.equal(notifications.length, 1);
    assert.match(lastMessage(notifications), /invalid time/i);
  });
});
