import { describe, expect, it } from "vitest";
import { z } from "zod";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import { validateRead } from "./read-ticket";
import {
  fromWire,
  OTHER_PRINTED_FIELDS,
  PART_2_FIELDS,
  TICKET_FIELDS,
  ticketReadSchema,
  ticketWireSchema,
  type TicketWire,
} from "./ticket-schema";

// SAMPLE ticket 3 as Claude would return it.
const WIRE: TicketWire = {
  buyer_name: "Main Street Elevator",
  ticket_number: "20888",
  ticket_date: "2026-10-12",
  ticket_time: "13:15",
  crop: "corn",
  gross_lbs: 79_740,
  tare_lbs: 24_580,
  net_lbs: 55_160,
  moisture_pct: 17.9,
  test_weight: 55.5,
  foreign_material_pct: 1.3,
  damage_pct: 2.1,
  dockage_pct: null,
  truck_number: "1",
  base_moisture_pct: 15,
  shrink_pct_per_point: 1.4,
  contract_number: "SAMPLE-C-2611",
  buyer_address: "SAMPLE: Main Street, Nevada, IA",
  direction: "in",
  purchase_type: "contract",
  customer: "Dave's Farm (SAMPLE)",
  grain: "Yellow Corn",
  driver_on: "on",
  wet_bu: 985,
  shrink_pct: 4.06,
  elevator_dry_bu: 945.01,
  weigher: "KL",
};

describe("the ticket schema", () => {
  const tickets = documentsOfKind(loadDocumentsFile(), "scale_ticket");

  it("has every value in spec Part 2, including the time in", () => {
    expect(PART_2_FIELDS).toHaveLength(17);
    expect(PART_2_FIELDS).toContain("ticket_time");
    expect(new Set(TICKET_FIELDS).size).toBe(PART_2_FIELDS.length + OTHER_PRINTED_FIELDS.length);
  });

  it("has exactly the values in the answer key, and both schemas agree", () => {
    const keyed = Object.keys(tickets[0][1].values).sort();
    expect([...TICKET_FIELDS].sort()).toEqual(keyed);
    expect(Object.keys(ticketReadSchema.shape).sort()).toEqual(keyed);
    expect(Object.keys(ticketWireSchema.shape).sort()).toEqual(keyed);
  });

  it.each(tickets)("accepts %s from the answer key as it is", (_name, doc) => {
    expect(ticketReadSchema.parse(doc.values)).toEqual(doc.values);
  });

  it("lets every value be null", () => {
    const blank = Object.fromEntries(TICKET_FIELDS.map((f) => [f, null]));
    expect(ticketReadSchema.parse(blank)).toEqual(blank);
  });

  it("takes the time in only as 24-hour HH:MM", () => {
    const withTime = (ticket_time: string) => validateRead({ ...fromWire(WIRE), ticket_time });
    expect(withTime("09:55").ok).toBe(true);
    expect(withTime("1:15 PM")).toEqual({
      ok: false,
      reason: expect.stringContaining("ticket_time"),
    });
    expect(withTime("24:00").ok).toBe(false);
  });
});

describe("what Claude fills in", () => {
  it("stays inside structured outputs' limit of 16 values that can be null", () => {
    const sent = z.toJSONSchema(ticketWireSchema) as { properties: Record<string, { anyOf?: unknown[]; type?: unknown }> };
    const unions = Object.values(sent.properties).filter((p) => p.anyOf || Array.isArray(p.type));
    expect(unions.length).toBeLessThanOrEqual(16);
  });

  it("describes every value for the model", () => {
    for (const [name, field] of Object.entries(ticketWireSchema.shape)) {
      expect(field.description, name).toBeTruthy();
    }
  });

  it("becomes the app's values unchanged when everything is there", () => {
    const ticket3 = loadDocumentsFile().documents["ticket-3"];
    expect(validateRead(fromWire(WIRE))).toEqual({ ok: true, values: ticket3.values });
  });

  it('turns "", unmarked boxes and "other" into null', () => {
    const blank: TicketWire = {
      ...WIRE,
      buyer_name: "",
      ticket_time: "  ",
      contract_number: "",
      crop: "other",
      direction: "unmarked",
      purchase_type: "unmarked",
      driver_on: "unmarked",
    };
    const read = validateRead(fromWire(blank));
    expect(read.ok && read.values).toMatchObject({
      buyer_name: null,
      ticket_time: null,
      contract_number: null,
      crop: null,
      direction: null,
      purchase_type: null,
      driver_on: null,
    });
  });

  it("reads the driver boxes as true and false, and trims text", () => {
    const read = validateRead(fromWire({ ...WIRE, driver_on: "off", weigher: " KL " }));
    expect(read.ok && read.values).toMatchObject({ driver_on: false, weigher: "KL" });
  });
});
