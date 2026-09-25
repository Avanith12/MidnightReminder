/**
 * Pure time-policy logic for the Midnight Reminder extension.
 *
 * The reminder window is local time 00:00 (inclusive) to 06:00 (exclusive).
 */

/** Window start hour (inclusive) in local time. */
const WINDOW_START_HOUR = 0;

/** Window end hour (exclusive) in local time. */
const WINDOW_END_HOUR = 6;

/** True when `now` falls inside the local reminder window [00:00, 06:00). */
export function isWithinReminderWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/** Stable local calendar-day key (YYYY-MM-DD) used to deduplicate reminders. */
export function reminderDayKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * True when a reminder should be emitted for `now`, given the local day key of
 * the last reminder (`null` when none has fired yet).
 */
export function shouldRemind(now: Date, lastRemindedDayKey: string | null): boolean {
  if (!isWithinReminderWindow(now)) {
    return false;
  }
  return reminderDayKey(now) !== lastRemindedDayKey;
}
