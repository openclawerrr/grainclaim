/**
 * How numbers, dates and times are shown on screens. Calculations never
 * round; these do, at the last moment. Pure, and safe in client components.
 */

/** Bushels with two decimals, as tickets print them: 991.43. */
export function formatBushels(bushels: number): string {
  return bushels.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Whole bushels for the big totals: 5,720. */
export function formatWholeBushels(bushels: number): string {
  return bushels.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Pounds with a thousands separator: 80,120. */
export function formatPounds(pounds: number): string {
  return pounds.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** A percentage as written on a ticket: 17.5%, 4.48%, 15%. */
export function formatPercent(percent: number): string {
  return `${percent.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** A number with up to two decimals and no unit: test weight 55.8. */
export function formatDecimal(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A calendar date (YYYY-MM-DD) as "Oct 12, 2026". No time zone is applied, so the day never shifts. */
export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${Number(day)}, ${year}` : date;
}

/** The day a moment (an ISO time) fell on in a time zone, as "Oct 12, 2026". */
export function formatDayOf(isoTime: string, timeZone: string): string {
  const moment = new Date(isoTime);
  if (Number.isNaN(moment.getTime())) return isoTime;
  return moment.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" });
}

/** A 24-hour time (HH:MM or HH:MM:SS) as "10:42 AM". */
export function formatTime(time: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/** "1 ticket", "2 tickets", "0 tickets". */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

/** Acres with two decimals, as the FSA-578 prints them: 80.20. */
export function formatAcres(acres: number): string {
  return acres.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
