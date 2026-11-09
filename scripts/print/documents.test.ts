import { describe, expect, it } from "vitest";
import { elevatorDryBushels, insuranceProductionToCount, wetBushels } from "../../lib/rules/ticket";
import { guaranteeBushels } from "../../lib/rules/unit";
import { loadSampleFiles } from "../seed/sample-files";
import { findDocumentProblems, round } from "./checks";
import { documentsFileSchema, documentsOfKind, loadDocumentsFile, type DocumentsFile } from "./documents-file";

const file = loadDocumentsFile();
const sample = loadSampleFiles();
const copy = (): DocumentsFile => structuredClone(file);

const tickets = documentsOfKind(file, "scale_ticket");
const [[, fsa]] = documentsOfKind(file, "fsa_578");
const [[, soc]] = documentsOfKind(file, "summary_of_coverage");
const [[, settlement]] = documentsOfKind(file, "settlement");
const ticket = (name: string) => {
  const found = tickets.find(([n]) => n === name);
  if (!found) throw new Error(`no ${name}`);
  return found[1].values;
};
const field = (name: string) => {
  const f = sample.fields.find((x) => x.properties.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f.properties;
};
const minutes = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`) / 60_000;

describe("documents-2026.json", () => {
  it("passes every check against lib/rules and the sample farm", () => {
    expect(findDocumentProblems(file, sample)).toEqual([]);
  });

  it("keys every document by the name its PDF and photo use", () => {
    expect(Object.keys(file.documents)).toEqual([
      "ticket-1",
      "ticket-2",
      "ticket-3",
      "ticket-4",
      "ticket-5",
      "ticket-6",
      "fsa-578",
      "summary-of-coverage",
      "settlement",
    ]);
  });

  it("photographs the tickets and the FSA-578, and uploads the Summary of Coverage and settlement as PDFs", () => {
    const delivery = Object.fromEntries(Object.entries(file.documents).map(([n, d]) => [n, d.delivery]));
    expect(delivery).toMatchObject({
      "ticket-1": "photo",
      "ticket-6": "photo",
      "fsa-578": "photo",
      "summary-of-coverage": "pdf",
      settlement: "pdf",
    });
  });
});

describe("spec Part 9", () => {
  it("has 6 Main Street Elevator tickets: 4 from Truck 1 and 2 from Truck 2", () => {
    expect(tickets).toHaveLength(6);
    for (const [, t] of tickets) expect(t.values.buyer_name).toBe("Main Street Elevator");
    const trucks = tickets.map(([, t]) => t.values.truck_number);
    expect(trucks.filter((n) => n === "1")).toHaveLength(4);
    expect(trucks.filter((n) => n === "2")).toHaveLength(2);
  });

  it("has exactly one ticket filled in by hand: ticket-3", () => {
    expect(tickets.filter(([, t]) => t.filled_in === "by_hand").map(([n]) => n)).toEqual(["ticket-3"]);
  });

  it("totals about 5,800 wet bushels (5,719.64), the most two trucks carry in 6 loads", () => {
    const wet = round(tickets.reduce((s, [, t]) => s + t.values.wet_bu, 0), 2);
    expect(wet).toBe(5719.64);
    // 4 loads × 1,000 bu + 2 loads × 900 bu, every truck full.
    expect(wet).toBeLessThanOrEqual(5800);
  });

  it("makes ticket-1 the worked example in lib/rules/ticket.test.ts", () => {
    const t = ticket("ticket-1");
    expect([t.gross_lbs, t.tare_lbs, t.moisture_pct]).toEqual([80_120, 24_600, 17.5]);
    const wet = wetBushels(t.net_lbs, "corn");
    expect(round(insuranceProductionToCount(wet, "corn", t.moisture_pct), 2)).toBe(961.69);
    expect(round(elevatorDryBushels(wet, t.moisture_pct, { baseMoisturePct: 15, shrinkPctPerPoint: 1.4 }), 2)).toBe(956.73);
  });

  it("prints a date and time on every ticket, inside North 80's harvest on Oct 12–13, 2026", () => {
    for (const [, { values: t }] of tickets) {
      expect(["2026-10-12", "2026-10-13"]).toContain(t.ticket_date);
      expect(t.ticket_time >= "07:00" && t.ticket_time <= "19:00").toBe(true);
    }
  });

  it("numbers tickets in the order they were weighed, with at least an hour between one truck's loads", () => {
    const byTime = [...tickets].sort(
      ([, a], [, b]) => minutes(a.values.ticket_date, a.values.ticket_time) - minutes(b.values.ticket_date, b.values.ticket_time),
    );
    const numbers = byTime.map(([, t]) => Number(t.values.ticket_number));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));

    // The elevator is about 5 miles away: load, drive, weigh, dump and return take an hour or more.
    for (const truck of ["1", "2"]) {
      const times = byTime
        .filter(([, t]) => t.values.truck_number === truck)
        .map(([, t]) => minutes(t.values.ticket_date, t.values.ticket_time));
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(60);
    }
  });

  it("lists 5 of the 6 tickets on the settlement, leaving out ticket-5", () => {
    const listed = settlement.values.tickets.map((l) => l.ticket_number);
    const missing = tickets.filter(([, t]) => !listed.includes(t.values.ticket_number)).map(([n]) => n);
    expect(listed).toHaveLength(5);
    expect(missing).toEqual(["ticket-5"]);
  });

  it("shows 80.20 acres for North 80 on the FSA-578 and 80.00 on the Summary of Coverage, the only acre difference", () => {
    const differences = fsa.values.fields.flatMap((line) => {
      const unit = soc.values.units.find((u) => u.fsa_tract === line.tract && u.fsa_field === line.field);
      return unit && unit.acres !== line.reported_acres ? [[line.tract, line.field, line.reported_acres, unit.acres]] : [];
    });
    const north = field("North 80");
    expect(differences).toEqual([[north.fsa_tract, north.fsa_field, 80.2, 80]]);
  });

  it("lets season setup reach the build plan's guarantees of 10,827 and 3,600 bu from the FSA-578 acres", () => {
    const guarantees = fsa.values.fields.map((line) => {
      const unit = soc.values.units.find((u) => u.fsa_tract === line.tract && u.fsa_field === line.field);
      if (!unit) throw new Error(`no unit for tract ${line.tract}`);
      return Math.round(
        guaranteeBushels({
          approvedYield: unit.approved_yield,
          coverageLevel: soc.values.coverage_level,
          acres: line.reported_acres,
          share: unit.insured_share,
        }),
      );
    });
    expect(guarantees).toEqual([10_827, 3_600]);
    // The Summary of Coverage's own figures use its 80.00 acres.
    expect(soc.values.units.map((u) => u.guarantee_bu)).toEqual([10_800, 3_600]);
  });
});

describe("findDocumentProblems catches", () => {
  it("a net weight that isn't gross − tare", () => {
    const f = copy();
    const t = f.documents["ticket-2"];
    if (t.kind !== "scale_ticket") throw new Error("ticket-2 is not a ticket");
    t.values.net_lbs = 49_850;
    expect(findDocumentProblems(f, sample)).toContain("ticket-2: net weight is 49,850 lb but gross − tare is 49,840 lb.");
  });

  it("a load bigger than its truck", () => {
    const f = copy();
    const t = f.documents["ticket-1"];
    if (t.kind !== "scale_ticket") throw new Error("ticket-1 is not a ticket");
    t.values.truck_number = "2";
    expect(findDocumentProblems(f, sample)).toEqual(["ticket-1: Truck 2 holds 900 bu but the ticket shows 991.43."]);
  });

  it("dry bushels that disagree with lib/rules", () => {
    const f = copy();
    const t = f.documents["ticket-4"];
    if (t.kind !== "scale_ticket") throw new Error("ticket-4 is not a ticket");
    t.values.elevator_dry_bu = 955.31;
    expect(findDocumentProblems(f, sample)).toContain("ticket-4: dry bushels are 955.31 but lib/rules gives 955.3.");
  });

  it("a settlement line that disagrees with its ticket, and the totals it throws off", () => {
    const f = copy();
    const s = f.documents.settlement;
    if (s.kind !== "settlement") throw new Error("not a settlement");
    s.values.tickets[0].elevator_dry_bu = 956.74;
    const problems = findDocumentProblems(f, sample);
    expect(problems).toContain("settlement: ticket 20871 shows elevator_dry_bu 956.74 but ticket-1 shows 956.73.");
    expect(problems).toContain("settlement: total dry bu is 4,676.02 but should be 4,676.03.");
  });

  it("a settlement listing a ticket that isn't a document", () => {
    const f = copy();
    const s = f.documents.settlement;
    if (s.kind !== "settlement") throw new Error("not a settlement");
    s.values.tickets[4].ticket_number = "99999";
    expect(findDocumentProblems(f, sample)).toEqual(["settlement: ticket 99999 is not one of the ticket documents."]);
  });

  it("FSA-578 acres that differ from the map, and a mapped field left off the form", () => {
    const f = copy();
    const form = f.documents["fsa-578"];
    if (form.kind !== "fsa_578") throw new Error("not an FSA-578");
    form.values.fields[0].reported_acres = 80;
    form.values.fields.pop();
    const problems = findDocumentProblems(f, sample);
    expect(problems).toContain("fsa-578: North 80 reports 80 acres but the map measures 80.2.");
    expect(problems).toContain("fsa-578: South 40 is on the map but not on the form, which would fire the unreported-acres flag.");
  });

  it("a Summary of Coverage guarantee that doesn't follow from its own acres", () => {
    const f = copy();
    const summary = f.documents["summary-of-coverage"];
    if (summary.kind !== "summary_of_coverage") throw new Error("not a Summary of Coverage");
    summary.values.units[0].guarantee_bu = 10_827;
    expect(findDocumentProblems(f, sample)).toContain("summary-of-coverage: Unit 1's guarantee should be 10800 bu.");
  });

  it("a projected price that differs from season-2026.json", () => {
    const f = copy();
    const summary = f.documents["summary-of-coverage"];
    if (summary.kind !== "summary_of_coverage") throw new Error("not a Summary of Coverage");
    summary.values.projected_price = 4.6;
    expect(findDocumentProblems(f, sample)).toContain(
      "summary-of-coverage: projected price 4.6 differs from season-2026.json (4.62).",
    );
  });

  it("a document whose name doesn't match its kind", () => {
    const f = copy();
    f.documents.acreage = f.documents["fsa-578"];
    delete f.documents["fsa-578"];
    expect(findDocumentProblems(f, sample)).toEqual([
      "acreage: a fsa_578 document must be named like ^fsa-578(-\\d+)?$.",
    ]);
  });
});

describe("documentsFileSchema", () => {
  const withTicket1 = (change: (values: Record<string, unknown>) => void) => {
    const raw = structuredClone(file) as unknown as { documents: Record<string, { values: Record<string, unknown> }> };
    change(raw.documents["ticket-1"].values);
    return documentsFileSchema.safeParse(raw).success;
  };

  it("accepts the file as it is", () => {
    expect(withTicket1(() => {})).toBe(true);
  });

  it("refuses a ticket time that isn't 24-hour HH:MM", () => {
    expect(withTicket1((v) => (v.ticket_time = "1:15 PM"))).toBe(false);
  });

  it("refuses a customer not marked SAMPLE", () => {
    expect(withTicket1((v) => (v.customer = "Dave's Farm"))).toBe(false);
  });

  it("refuses bushels with more decimals than the ticket prints", () => {
    expect(withTicket1((v) => (v.wet_bu = 991.4286))).toBe(false);
  });
});
