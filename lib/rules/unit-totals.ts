/**
 * A unit's running total, added up from tickets by following the record
 * chain: ticket → trip → the field the trip left from → that field's season
 * in the trip's crop year → unit. There is no stored counter.
 *
 * A ticket counts only when the whole chain is there. A ticket with no trip
 * (a second photo of the same ticket, or one not linked yet) counts nowhere,
 * and neither does one from a field that isn't insured, which has no unit.
 * Grain sold out of a bin (ticket ← trip ← bin ← fields) isn't followed yet;
 * that comes with bin contents in Milestone 4.
 *
 * Nothing here rounds: round only when displaying.
 */

export interface ChainTicket {
  production_to_count_bu: number | null;
  elevator_dry_bu: number | null;
  /** The trip this ticket closed, or null when it has none. */
  trip: { crop_year: number; origin_field_id: string | null } | null;
}

export interface ChainFieldSeason {
  field_id: string;
  crop_year: number;
  /** Null for a field that isn't insured: it is in no unit, so its tickets count toward no unit's total. */
  unit_id: string | null;
}

export interface ChainUnit {
  id: string;
  unit_number: string;
}

export interface UnitTotal {
  unitId: string;
  unitNumber: string;
  /** Tickets linked to this unit, including any whose bushels couldn't be calculated. */
  tickets: number;
  /** Insurance production to count: the number that goes against the guarantee. */
  productionToCountBu: number;
  /** What the buyer pays on. It differs from production to count. */
  elevatorDryBu: number;
}

/** The unit a ticket belongs to, or null when a link in the chain is missing. */
export function unitOfTicket(ticket: ChainTicket, fieldSeasons: readonly ChainFieldSeason[]): string | null {
  const trip = ticket.trip;
  if (!trip || trip.origin_field_id === null) return null;
  const season = fieldSeasons.find(
    (fs) => fs.field_id === trip.origin_field_id && fs.crop_year === trip.crop_year,
  );
  return season?.unit_id ?? null;
}

/** One total per unit, in the order the units are given. A unit with no tickets is zero. */
export function unitTotals(
  units: readonly ChainUnit[],
  fieldSeasons: readonly ChainFieldSeason[],
  tickets: readonly ChainTicket[],
): UnitTotal[] {
  const totals = new Map<string, UnitTotal>(
    units.map((unit) => [
      unit.id,
      { unitId: unit.id, unitNumber: unit.unit_number, tickets: 0, productionToCountBu: 0, elevatorDryBu: 0 },
    ]),
  );
  for (const ticket of tickets) {
    const unitId = unitOfTicket(ticket, fieldSeasons);
    const total = unitId === null ? undefined : totals.get(unitId);
    if (!total) continue;
    total.tickets += 1;
    total.productionToCountBu += ticket.production_to_count_bu ?? 0;
    total.elevatorDryBu += ticket.elevator_dry_bu ?? 0;
  }
  return [...totals.values()];
}
