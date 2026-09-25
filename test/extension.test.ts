import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import midnightReminder, { CHECK_INTERVAL_MS } from "../src/extension.ts";

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

  it("registers a manual /midnight-check command", () => {
    const { api, commands } = createFakePi();
    midnightReminder(api);

    assert.ok(commands.has("midnight-check"));
    assert.match(commands.get("midnight-check")?.description ?? "", /reminder/i);
  });
});
