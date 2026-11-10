import { describe, expect, it } from "vitest";
import { findOriginalTicket, matchBuyer, matchFarmTruck, type SavedTicketIdentity } from "./ticket-matching";

const TRUCK_1 = { id: "t1", name: "Truck 1", capacity_bu: 1000 };
const TRUCK_2 = { id: "t2", name: "Truck 2", capacity_bu: 900 };
const trucks = [TRUCK_1, TRUCK_2];

describe("matchFarmTruck", () => {
  it("matches the number printed on a sample ticket to the farm truck", () => {
    expect(matchFarmTruck("1", trucks)).toBe(TRUCK_1);
    expect(matchFarmTruck("2", trucks)).toBe(TRUCK_2);
  });

  it.each([["Truck 1"], ["truck #1"], ["#1"], ["No. 1"], [" 1 "], ["TRK 1"]])("reads %j as Truck 1", (written) => {
    expect(matchFarmTruck(written, trucks)).toBe(TRUCK_1);
  });

  it("doesn't match a truck the farm doesn't have", () => {
    expect(matchFarmTruck("22", trucks)).toBeNull();
    expect(matchFarmTruck("12", trucks)).toBeNull();
  });

  it("returns null when the truck number wasn't read", () => {
    expect(matchFarmTruck(null, trucks)).toBeNull();
    expect(matchFarmTruck("  ", trucks)).toBeNull();
  });

  it("returns null when two trucks share the number", () => {
    expect(matchFarmTruck("1", [TRUCK_1, { id: "t3", name: "truck 1", capacity_bu: 800 }])).toBeNull();
  });
});

const ELEVATOR = { id: "b1", name: "Main Street Elevator" };
const ETHANOL = { id: "b2", name: "Prairie Ethanol" };

describe("matchBuyer", () => {
  it("matches the name as printed", () => {
    expect(matchBuyer("Main Street Elevator", [ELEVATOR, ETHANOL])).toBe(ELEVATOR);
  });

  it("ignores capitals and extra spaces", () => {
    expect(matchBuyer(" MAIN  STREET elevator ", [ELEVATOR, ETHANOL])).toBe(ELEVATOR);
  });

  it("returns null for a buyer that isn't on record, or a name that wasn't read", () => {
    expect(matchBuyer("Main Street Elevators Inc", [ELEVATOR])).toBeNull();
    expect(matchBuyer(null, [ELEVATOR])).toBeNull();
    expect(matchBuyer("", [ELEVATOR])).toBeNull();
  });

  it("returns null when two buyers share the name", () => {
    expect(matchBuyer("Main Street Elevator", [ELEVATOR, { id: "b3", name: "main street elevator" }])).toBeNull();
  });
});

function saved(id: string, over: Partial<SavedTicketIdentity> = {}): SavedTicketIdentity {
  return {
    id,
    buyer_name: "Main Street Elevator",
    ticket_number: "20871",
    ticket_date: "2026-10-12",
    duplicate_of: null,
    uploaded_at: "2026-10-12T16:00:00Z",
    ...over,
  };
}
const ticket1 = { buyer_name: "Main Street Elevator", ticket_number: "20871", ticket_date: "2026-10-12" };

describe("findOriginalTicket", () => {
  it("finds an earlier ticket with the same buyer, number and date", () => {
    const first = saved("a");
    expect(findOriginalTicket(ticket1, [saved("b", { ticket_number: "20876" }), first])).toBe(first);
  });

  it("ignores capitals and spaces in the buyer's name and around the number", () => {
    const first = saved("a");
    const reread = { buyer_name: "MAIN STREET  ELEVATOR", ticket_number: " 20871 ", ticket_date: "2026-10-12" };
    expect(findOriginalTicket(reread, [first])).toBe(first);
  });

  it.each([
    ["a different number", { ticket_number: "20872" }],
    ["a different date", { ticket_date: "2026-10-13" }],
    ["a different buyer", { buyer_name: "Prairie Ethanol" }],
  ])("is new when the saved ticket has %s", (_, over) => {
    expect(findOriginalTicket(ticket1, [saved("a", over)])).toBeNull();
  });

  it("is never a duplicate when one of the three values wasn't read", () => {
    const first = saved("a");
    expect(findOriginalTicket({ ...ticket1, buyer_name: null }, [first])).toBeNull();
    expect(findOriginalTicket({ ...ticket1, ticket_number: null }, [first])).toBeNull();
    expect(findOriginalTicket({ ...ticket1, ticket_date: null }, [first])).toBeNull();
    expect(findOriginalTicket(ticket1, [saved("a", { ticket_number: null })])).toBeNull();
  });

  it("points a third photo at the first ticket, not at the second photo", () => {
    const first = saved("a");
    const second = saved("b", { duplicate_of: "a", uploaded_at: "2026-10-12T17:00:00Z" });
    expect(findOriginalTicket(ticket1, [second, first])).toBe(first);
  });

  it("picks the earliest when two originals exist", () => {
    const later = saved("b", { uploaded_at: "2026-10-12T18:00:00Z" });
    const earlier = saved("a", { uploaded_at: "2026-10-12T16:00:00Z" });
    expect(findOriginalTicket(ticket1, [later, earlier])).toBe(earlier);
  });
});
