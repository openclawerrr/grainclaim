import { describe, expect, it } from "vitest";
import { unitOfTicket, unitTotals, type ChainTicket } from "./unit-totals";

const units = [
  { id: "unit-1", unit_number: "1" },
  { id: "unit-2", unit_number: "2" },
];
const fieldSeasons = [
  { field_id: "north-80", crop_year: 2026, unit_id: "unit-1" },
  { field_id: "south-40", crop_year: 2026, unit_id: "unit-2" },
];

function ticket(fieldId: string | null, toCount: number | null, dry: number | null, cropYear = 2026): ChainTicket {
  return {
    production_to_count_bu: toCount,
    elevator_dry_bu: dry,
    trip: fieldId === null ? null : { crop_year: cropYear, origin_field_id: fieldId },
  };
}

describe("unitOfTicket", () => {
  it("follows ticket → trip → field → field season → unit", () => {
    expect(unitOfTicket(ticket("north-80", 961.69, 956.73), fieldSeasons)).toBe("unit-1");
    expect(unitOfTicket(ticket("south-40", 500, 490), fieldSeasons)).toBe("unit-2");
  });

  it("is null for a ticket with no trip", () => {
    expect(unitOfTicket(ticket(null, 961.69, 956.73), fieldSeasons)).toBeNull();
  });

  it("is null for a trip that left from a bin", () => {
    const fromBin: ChainTicket = {
      production_to_count_bu: 900,
      elevator_dry_bu: 890,
      trip: { crop_year: 2026, origin_field_id: null },
    };
    expect(unitOfTicket(fromBin, fieldSeasons)).toBeNull();
  });

  it("uses the field's season in the trip's crop year, since units change each year", () => {
    const seasons = [...fieldSeasons, { field_id: "north-80", crop_year: 2025, unit_id: "unit-2025" }];
    expect(unitOfTicket(ticket("north-80", 1, 1, 2025), seasons)).toBe("unit-2025");
    expect(unitOfTicket(ticket("north-80", 1, 1, 2024), seasons)).toBeNull();
  });
});

describe("a field that isn't insured", () => {
  // West 20 has a season, but no unit.
  const withUninsured = [...fieldSeasons, { field_id: "west-20", crop_year: 2026, unit_id: null }];

  it("has no unit for its tickets", () => {
    expect(unitOfTicket(ticket("west-20", 400, 395), withUninsured)).toBeNull();
  });

  it("counts toward no unit's total, and doesn't stop the others from adding up", () => {
    const totals = unitTotals(units, withUninsured, [ticket("north-80", 961.69, 956.73), ticket("west-20", 400, 395)]);
    expect(totals.map((t) => [t.unitNumber, t.tickets, t.productionToCountBu])).toEqual([
      ["1", 1, 961.69],
      ["2", 0, 0],
    ]);
  });
});

describe("unitTotals", () => {
  it("is zero for every unit before any ticket", () => {
    expect(unitTotals(units, fieldSeasons, [])).toEqual([
      { unitId: "unit-1", unitNumber: "1", tickets: 0, productionToCountBu: 0, elevatorDryBu: 0 },
      { unitId: "unit-2", unitNumber: "2", tickets: 0, productionToCountBu: 0, elevatorDryBu: 0 },
    ]);
  });

  it("adds one North 80 ticket to Unit 1 and nothing to Unit 2", () => {
    const [unit1, unit2] = unitTotals(units, fieldSeasons, [ticket("north-80", 961.69, 956.73)]);
    expect(unit1).toMatchObject({ tickets: 1, productionToCountBu: 961.69, elevatorDryBu: 956.73 });
    expect(unit2).toMatchObject({ tickets: 0, productionToCountBu: 0, elevatorDryBu: 0 });
  });

  it("keeps a running total as tickets are added", () => {
    const tickets = [ticket("north-80", 961.69, 956.73), ticket("north-80", 855.83, 850.13), ticket("south-40", 400, 395)];
    const [unit1, unit2] = unitTotals(units, fieldSeasons, tickets);
    expect(unit1.tickets).toBe(2);
    expect(unit1.productionToCountBu).toBeCloseTo(1817.52, 2);
    expect(unit1.elevatorDryBu).toBeCloseTo(1806.86, 2);
    expect(unit2).toMatchObject({ tickets: 1, productionToCountBu: 400, elevatorDryBu: 395 });
  });

  it("doesn't count a second photo of the same ticket, which has no trip", () => {
    const tickets = [ticket("north-80", 961.69, 956.73), ticket(null, 961.69, 956.73)];
    expect(unitTotals(units, fieldSeasons, tickets)[0]).toMatchObject({ tickets: 1, productionToCountBu: 961.69 });
  });

  it("counts a ticket whose bushels couldn't be calculated, adding nothing", () => {
    const [unit1] = unitTotals(units, fieldSeasons, [ticket("north-80", 961.69, 956.73), ticket("north-80", null, null)]);
    expect(unit1).toMatchObject({ tickets: 2, productionToCountBu: 961.69, elevatorDryBu: 956.73 });
  });

  it("leaves out a ticket whose unit isn't one of the units asked for", () => {
    expect(unitTotals([units[0]], fieldSeasons, [ticket("south-40", 400, 395)])).toEqual([
      { unitId: "unit-1", unitNumber: "1", tickets: 0, productionToCountBu: 0, elevatorDryBu: 0 },
    ]);
  });
});
