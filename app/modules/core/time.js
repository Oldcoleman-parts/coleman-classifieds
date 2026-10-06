// Calendar maths in the shop timezone. Listing periods are calendar months, never 30 days.
import { TZDate } from "@date-fns/tz";
import { addMonths as addCalendarMonths } from "date-fns";
import { AppError } from "./errors.js";

export const MINUTE_MS = 60_000;
export const DAY_MINUTES = 24 * 60;

// DECISION: the shop timezone comes from SHOP_TIMEZONE (an IANA name). OCP is in the US
// Eastern zone, so that is the default; confirm with OCP before launch (F01-T2 notes).
const DEFAULT_TIME_ZONE = "America/New_York";

/** @returns {string} the IANA timezone used for month maths and displayed dates */
export function shopTimeZone() {
  const zone = process.env.SHOP_TIMEZONE || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new AppError("SHOP_TIMEZONE is not a valid timezone", {
      code: "CONFIG",
    });
  }
  return zone;
}

/**
 * Add calendar months as the shop sees them: Jan 31 + 1 month is the last day of February,
 * and the wall-clock time is kept across daylight-saving changes.
 * @param {Date} date
 * @param {number} [months]
 * @param {string} [timeZone]
 * @returns {Date}
 */
export function addMonths(date, months = 1, timeZone = shopTimeZone()) {
  const local = new TZDate(date.getTime(), timeZone);
  return new Date(addCalendarMonths(local, months).getTime());
}

/**
 * DECISION: day windows (draft, correction, payment, retention) are fixed 24-hour blocks,
 * not calendar days, so a deadline never moves by an hour in a daylight-saving week.
 * @param {Date} date
 * @param {number} days
 * @returns {Date}
 */
export function addDays(date, days) {
  return addMinutes(date, days * DAY_MINUTES);
}

/**
 * @param {Date} date
 * @param {number} minutes
 * @returns {Date}
 */
export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}
