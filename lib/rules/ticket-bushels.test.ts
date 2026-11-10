import { describe, expect, it } from "vitest";
import { CALC_VERSION, ticketBushels, type TicketBushelsInput } from "./ticket-bushels";

/** Sample ticket 1: corn at 17.5%, buyer's base 15% and 1.4% shrink per point. */
const TICKET_1: TicketBushelsInput = {
  crop: "corn",
  gross_lbs: 80_120,
  tare_lbs: 24_600,
  moisture_pct: 17.5,
  base_moisture_pct: 15,
  shrink_pct_per_point: 1.4,
};

describe("ticketBushels", () => {
  it("calculates all three figures for sample ticket 1", () => {
    const bushels = ticketBushels(TICKET_1);
    expect(bushels.wet_bu).toBeCloseTo(991.43, 2);
    expect(bushels.elevator_dry_bu).toBeCloseTo(956.73, 2);
    expect(bushels.production_to_count_bu).toBeCloseTo(961.69, 2);
    expect(bushels.problems).toEqual([]);
  });

  it("uses gross − tare, never a net weight from the ticket", () => {
    // The input has no net weight at all.
    expect(ticketBushels(TICKET_1).wet_bu).toBe((80_120 - 24_600) / 56);
  });

  it("gives no figures when a weight wasn't read", () => {
    const bushels = ticketBushels({ ...TICKET_1, gross_lbs: null });
    expect(bushels).toMatchObject({ wet_bu: null, elevator_dry_bu: null, production_to_count_bu: null });
    expect(bushels.problems).toEqual(["Bushels can't be calculated because gross weight wasn't read."]);
  });

  it("names every missing value in one sentence", () => {
    const bushels = ticketBushels({ ...TICKET_1, gross_lbs: null, tare_lbs: null, crop: null });
    expect(bushels.problems).toEqual([
      "Bushels can't be calculated because gross weight, tare weight and the crop weren't read.",
    ]);
  });

  it("treats a crop it doesn't know as not read", () => {
    const bushels = ticketBushels({ ...TICKET_1, crop: "oats" });
    expect(bushels.wet_bu).toBeNull();
    expect(bushels.problems[0]).toContain("the crop wasn't read");
  });

  it("still gives wet bushels when moisture wasn't read", () => {
    const bushels = ticketBushels({ ...TICKET_1, moisture_pct: null });
    expect(bushels.wet_bu).toBeCloseTo(991.43, 2);
    expect(bushels.elevator_dry_bu).toBeNull();
    expect(bushels.production_to_count_bu).toBeNull();
    expect(bushels.problems).toEqual([
      "Dry bushels and production to count can't be calculated because moisture wasn't read.",
    ]);
  });

  it("still gives production to count when the buyer's shrink wasn't read", () => {
    const bushels = ticketBushels({ ...TICKET_1, shrink_pct_per_point: null });
    expect(bushels.elevator_dry_bu).toBeNull();
    expect(bushels.production_to_count_bu).toBeCloseTo(961.69, 2);
    expect(bushels.problems).toEqual([
      "Elevator dry bushels can't be calculated because the buyer's shrink rate wasn't read.",
    ]);
  });

  it("turns a weight the rules refuse into a sentence, not a number", () => {
    const bushels = ticketBushels({ ...TICKET_1, gross_lbs: 24_600, tare_lbs: 80_120 });
    expect(bushels.wet_bu).toBeNull();
    expect(bushels.problems).toEqual([
      "Tare (80120 lb) is greater than gross (24600 lb). Check the ticket read.",
    ]);
  });

  it("gives wet and dry bushels for wheat, and says why there is no production to count", () => {
    const bushels = ticketBushels({ ...TICKET_1, crop: "wheat", moisture_pct: 13.5, base_moisture_pct: 13.5 });
    expect(bushels.wet_bu).toBeCloseTo(55_520 / 60, 6);
    expect(bushels.elevator_dry_bu).toBeCloseTo(55_520 / 60, 6);
    expect(bushels.production_to_count_bu).toBeNull();
    expect(bushels.problems[0]).toContain("No insurance moisture rule for wheat");
  });

  it("has a version to save beside the figures", () => {
    expect(CALC_VERSION).toBe("1");
  });
});
