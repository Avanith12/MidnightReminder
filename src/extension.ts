import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReminderChecker, type ReminderChecker } from "./reminder.ts";

/** How often Pi re-checks the time while a session is active. */
export const CHECK_INTERVAL_MS = 60_000;

/**
 * Midnight Reminder Pi extension.
 *
 * Starts a poll interval on `session_start` and clears it on
 * `session_shutdown`. All reminder decisions come from the tested pure policy
 * via `createReminderChecker`.
 */
export default function midnightReminder(pi: ExtensionAPI): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let checker: ReminderChecker | undefined;

  pi.on("session_start", (_event, ctx) => {
    checker = createReminderChecker({
      notify: (message, type) => {
        if (ctx.hasUI) {
          ctx.ui.notify(message, type);
        }
      },
    });

    // Check immediately so a session started inside the window is reminded.
    checker.check();

    // Keep checking for as long as the session is active.
    timer = setInterval(() => checker?.check(), CHECK_INTERVAL_MS);
  });

  // Idempotent cleanup: reload, quit, and session replacement all converge here.
  pi.on("session_shutdown", () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    checker = undefined;
  });

  // Manual trigger so the reminder can be demonstrated without waiting for 00:00.
  pi.registerCommand("midnight-check", {
    description: "Run the midnight reminder check now",
    handler: async (_args, ctx) => {
      const fired = checker?.check() ?? false;
      if (ctx.hasUI) {
        ctx.ui.notify(
          fired ? "Midnight reminder fired." : "No reminder needed right now.",
          "info",
        );
      }
    },
  });
}
