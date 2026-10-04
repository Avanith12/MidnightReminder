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

/**
 * Parse a local wall-clock timestamp in `YYYY-MM-DD HH:mm` (or ISO-style
 * `YYYY-MM-DDTHH:mm`) form into a `Date`. Returns `null` for anything that is
 * not a real local calendar date/time, so callers can report a clear error.
 */
export function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value.trim());
  if (match === null) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }

  // Reject rolled-over dates such as 2026-02-30 by verifying round-trip fields.
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
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
