import { reminderDayKey, shouldRemind } from "./midnight.ts";

export type ReminderNotificationType = "info" | "warning" | "error";

export interface ReminderCheckerOptions {
  /** Emit a reminder. Called only when a reminder is due. */
  notify: (message: string, type?: ReminderNotificationType) => void;
  /** Clock injection for tests. Defaults to the real local wall clock. */
  now?: () => Date;
  /** Message shown when a reminder fires. */
  message?: string;
}

export interface ReminderChecker {
  /** Runs one check. Returns true when a reminder was emitted. */
  check(): boolean;
  /** Local day key of the last emitted reminder (for inspection/tests). */
  lastRemindedDayKey(): string | null;
}

export const DEFAULT_REMINDER_MESSAGE =
  "It is past midnight - time to wrap up and get some rest.";

/**
 * Stateful, Pi-independent coordinator around the pure time policy.
 *
 * It owns the "last reminded local day" state so repeated checks within one
 * session cannot emit more than one reminder per local calendar day.
 */
export function createReminderChecker(options: ReminderCheckerOptions): ReminderChecker {
  const now = options.now ?? (() => new Date());
  const message = options.message ?? DEFAULT_REMINDER_MESSAGE;
  let lastRemindedDayKey: string | null = null;

  return {
    check(): boolean {
      const current = now();
      if (!shouldRemind(current, lastRemindedDayKey)) {
        return false;
      }
      lastRemindedDayKey = reminderDayKey(current);
      options.notify(message, "info");
      return true;
    },
    lastRemindedDayKey(): string | null {
      return lastRemindedDayKey;
    },
  };
}
