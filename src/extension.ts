import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseLocalDateTime } from "./midnight.ts";
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
  // Accepts an optional simulated local time (YYYY-MM-DD HH:mm); with no
  // argument it checks the real clock.
  pi.registerCommand("bedtime-test", {
    description:
      "Run the bedtime reminder check now, optionally at a simulated local time (YYYY-MM-DD HH:mm)",
    handler: async (args, ctx) => {
      const raw = typeof args === "string" ? args.trim() : "";
      let simulated: Date | undefined;

      if (raw.length > 0) {
        const parsed = parseLocalDateTime(raw);
        if (parsed === null) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              `Invalid time "${raw}". Use YYYY-MM-DD HH:mm, for example /bedtime-test 2026-01-15 00:30.`,
              "warning",
            );
          }
          return;
        }
        simulated = parsed;
      }

      const fired = checker?.check(simulated) ?? false;
      if (ctx.hasUI) {
        ctx.ui.notify(
          fired
            ? simulated
              ? `Bedtime reminder fired for ${raw}.`
              : "Bedtime reminder fired."
            : simulated
              ? `No reminder for ${raw}: outside 00:00-06:00 or already reminded that day.`
              : "No reminder needed right now.",
          "info",
        );
      }
    },
  });
}
