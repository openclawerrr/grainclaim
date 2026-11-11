import { describe, expect, it } from "vitest";
import {
  countOf,
  formatAcres,
  formatBushels,
  formatDate,
  formatDayOf,
  formatDecimal,
  formatPercent,
  formatPounds,
  formatTime,
  formatWholeBushels,
} from "./format";

describe("format", () => {
  it("shows bushels with two decimals", () => {
    expect(formatBushels(991.4285714)).toBe("991.43");
    expect(formatBushels(890)).toBe("890.00");
    expect(formatBushels(5720.5)).toBe("5,720.50");
  });

  it("shows totals in whole bushels", () => {
    expect(formatWholeBushels(961.69)).toBe("962");
    expect(formatWholeBushels(5535.2)).toBe("5,535");
    expect(formatWholeBushels(0)).toBe("0");
  });

  it("shows acres with two decimals, as the FSA-578 prints them", () => {
    expect(formatAcres(80.2)).toBe("80.20");
    expect(formatAcres(40)).toBe("40.00");
    expect(formatAcres(1234.567)).toBe("1,234.57");
  });

  it("shows pounds with a thousands separator", () => {
    expect(formatPounds(80120)).toBe("80,120");
  });

  it("shows percentages as written", () => {
    expect(formatPercent(17.5)).toBe("17.5%");
    expect(formatPercent(4.48)).toBe("4.48%");
    expect(formatPercent(15)).toBe("15%");
  });

  it("shows other decimals without padding", () => {
    expect(formatDecimal(55.8)).toBe("55.8");
    expect(formatDecimal(56)).toBe("56");
  });

  it("shows a calendar date without shifting it by a time zone", () => {
    expect(formatDate("2026-10-12")).toBe("Oct 12, 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("soon")).toBe("soon");
  });

  it("shows the day a moment fell on in the farm's time zone", () => {
    // 1:30 AM UTC on the 13th is still the evening of the 12th in Iowa.
    expect(formatDayOf("2026-10-13T01:30:00+00:00", "America/Chicago")).toBe("Oct 12, 2026");
    expect(formatDayOf("2026-10-12T16:05:00Z", "America/Chicago")).toBe("Oct 12, 2026");
    expect(formatDayOf("soon", "America/Chicago")).toBe("soon");
  });

  it("shows a 24-hour time on a 12-hour clock", () => {
    expect(formatTime("10:42")).toBe("10:42 AM");
    expect(formatTime("13:15:00")).toBe("1:15 PM");
    expect(formatTime("00:05")).toBe("12:05 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("noon")).toBe("noon");
  });

  it("counts with the right plural", () => {
    expect(countOf(1, "ticket")).toBe("1 ticket");
    expect(countOf(0, "ticket")).toBe("0 tickets");
    expect(countOf(6, "ticket")).toBe("6 tickets");
  });
});
