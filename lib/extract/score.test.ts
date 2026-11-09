import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import { checkTicket, type HarvestWindow } from "../rules/ticket-checks";
import { readCostUsd } from "./models";
import { percent, scoreRead, summarize, valuesMatch, type AnswerKey, type ScoredRead } from "./score";
import { OTHER_PRINTED_FIELDS, PART_2_FIELDS, TICKET_FIELDS, type TicketRead } from "./ticket-schema";

const HARVEST: HarvestWindow = { after: "2026-05-02", through: "2026-12-31" };
const tickets = documentsOfKind(loadDocumentsFile(), "scale_ticket");
const TICKET_3: AnswerKey = tickets.find(([name]) => name === "ticket-3")![1].values;

/** A read of ticket 3 with some values changed, scored and checked the way the script does. */
function scored(changes: Partial<TicketRead>, extra: Partial<ScoredRead> = {}): ScoredRead {
  const read = { ...(TICKET_3 as TicketRead), ...changes };
  return {
    ticket: "ticket-3",
    run: 1,
    filledIn: "by_hand",
    failure: null,
    fields: scoreRead(read, TICKET_3),
    checks: checkTicket(read, HARVEST),
    ...extra,
  };
}

describe("valuesMatch", () => {
  it("numbers must match exactly", () => {
    expect(valuesMatch("gross_lbs", 79_740, 79_740)).toBe(true);
    expect(valuesMatch("gross_lbs", 77_740, 79_740)).toBe(false);
    expect(valuesMatch("wet_bu", 985.0, 985)).toBe(true);
    expect(valuesMatch("elevator_dry_bu", 945.02, 945.01)).toBe(false);
  });

  it("names and addresses ignore case, spacing and punctuation", () => {
    expect(valuesMatch("customer", "Dave's Farm (Sample)", "Dave's Farm (SAMPLE)")).toBe(true);
    expect(valuesMatch("customer", "Dave’s Farm  (sample)", "Dave's Farm (SAMPLE)")).toBe(true);
    expect(valuesMatch("buyer_address", "SAMPLE: Main Street Nevada, IA", "SAMPLE: Main Street, Nevada, IA")).toBe(true);
    expect(valuesMatch("buyer_name", "MAIN STREET ELEVATOR", "Main Street Elevator")).toBe(true);
    expect(valuesMatch("customer", "Dale's Farm (SAMPLE)", "Dave's Farm (SAMPLE)")).toBe(false);
  });

  it("ticket, contract and truck numbers ignore case only", () => {
    expect(valuesMatch("contract_number", "Sample-C-2611", "SAMPLE-C-2611")).toBe(true);
    expect(valuesMatch("contract_number", "SAMPLE C 2611", "SAMPLE-C-2611")).toBe(false);
    expect(valuesMatch("ticket_number", "20838", "20888")).toBe(false);
    expect(valuesMatch("weigher", "kl", "KL")).toBe(true);
  });

  it("dates, times and boxes must match exactly", () => {
    expect(valuesMatch("ticket_time", "13:15", "13:15")).toBe(true);
    expect(valuesMatch("ticket_time", "01:15", "13:15")).toBe(false);
    expect(valuesMatch("ticket_date", "2026-10-13", "2026-10-12")).toBe(false);
    expect(valuesMatch("driver_on", false, true)).toBe(false);
    expect(valuesMatch("purchase_type", "spot", "contract")).toBe(false);
  });

  it("a value the ticket doesn't have must be read as null, and a value it has must not", () => {
    expect(valuesMatch("dockage_pct", null, null)).toBe(true);
    expect(valuesMatch("dockage_pct", 0, null)).toBe(false);
    expect(valuesMatch("moisture_pct", null, 17.9)).toBe(false);
  });
});

describe("scoreRead", () => {
  it.each(tickets)("the answer key for %s scores 27 of 27 against itself", (_name, doc) => {
    const scores = scoreRead(doc.values, doc.values);
    expect(scores.map((s) => s.field)).toEqual([...TICKET_FIELDS]);
    expect(scores.every((s) => s.correct)).toBe(true);
  });

  it("marks only the value that differs", () => {
    const scores = scoreRead({ ...(TICKET_3 as TicketRead), gross_lbs: 77_740 }, TICKET_3);
    expect(scores.filter((s) => !s.correct)).toEqual([
      { field: "gross_lbs", correct: false, read: 77_740, expected: 79_740 },
    ]);
  });

  it("a failed read scores every value wrong, even the ones the ticket doesn't have", () => {
    const scores = scoreRead(null, TICKET_3);
    expect(scores).toHaveLength(27);
    expect(scores.some((s) => s.correct)).toBe(false);
  });
});

describe("summarize", () => {
  it("adds up by value, by group and by how the ticket was filled in", () => {
    const summary = summarize([
      scored({}),
      scored({ gross_lbs: 77_740 }, { run: 2 }),
      scored({ weigher: "KC" }, { ticket: "ticket-1", filledIn: "printed" }),
    ]);
    expect(summary.reads).toBe(3);
    expect(summary.all).toEqual({ correct: 79, total: 81 });
    expect(summary.part2).toEqual({ correct: 50, total: 3 * PART_2_FIELDS.length });
    expect(summary.otherPrinted).toEqual({ correct: 29, total: 3 * OTHER_PRINTED_FIELDS.length });
    expect(summary.byHand).toEqual({ correct: 53, total: 54 });
    expect(summary.printed).toEqual({ correct: 26, total: 27 });
    expect(summary.perField.gross_lbs).toEqual({ correct: 2, total: 3 });
    expect(summary.perField.net_lbs).toEqual({ correct: 3, total: 3 });
    expect(percent(summary.all)).toBe("97.5%");
  });

  it("says which misreads a failed check caught", () => {
    const summary = summarize([scored({ gross_lbs: 77_740, weigher: "KC", moisture_pct: null }, { run: 2 })]);
    expect(summary.misses).toEqual([
      {
        ticket: "ticket-3",
        run: 2,
        field: "gross_lbs",
        read: 77_740,
        expected: 79_740,
        kind: "wrong",
        checkable: true,
        caughtBy: ["net_weight"],
      },
      {
        ticket: "ticket-3",
        run: 2,
        field: "moisture_pct",
        read: null,
        expected: 17.9,
        kind: "blank",
        checkable: true,
        caughtBy: [],
      },
      {
        ticket: "ticket-3",
        run: 2,
        field: "weigher",
        read: "KC",
        expected: "KL",
        kind: "wrong",
        checkable: false,
        caughtBy: [],
      },
    ]);
    // A blank isn't a wrong value: it's visibly missing, so it isn't the checks' job.
    expect(summary.checks).toEqual({ wrongValues: 2, caught: 1, slippedThrough: 0, notCheckable: 1, falseAlarms: 0 });
  });

  it("counts a wrong value that passes every check as slipped through", () => {
    // Test weight isn't used by any check; a date one day off is still inside harvest.
    const summary = summarize([scored({ ticket_date: "2026-10-13", test_weight: 58.5 })]);
    expect(summary.checks).toEqual({ wrongValues: 2, caught: 0, slippedThrough: 1, notCheckable: 1, falseAlarms: 0 });
  });

  it("counts a failed check on correctly read values as a false alarm", () => {
    // The read matches the key, but the key's own net weight doesn't add up.
    const key: AnswerKey = { ...TICKET_3, net_lbs: 55_100 };
    const read = key as TicketRead;
    const summary = summarize([
      { ticket: "t", run: 1, filledIn: "printed", failure: null, fields: scoreRead(read, key), checks: checkTicket(read, HARVEST) },
    ]);
    expect(summary.misses).toEqual([]);
    expect(summary.checks.falseAlarms).toBe(2); // net weight and bushels
  });

  it("lists a failed read once and counts its 27 values wrong", () => {
    const failed: ScoredRead = {
      ticket: "ticket-3",
      run: 1,
      filledIn: "by_hand",
      failure: "The answer was cut off before it finished.",
      fields: scoreRead(null, TICKET_3),
      checks: [],
    };
    const summary = summarize([failed, scored({}, { run: 2 })]);
    expect(summary.failedReads).toEqual([
      { ticket: "ticket-3", run: 1, reason: "The answer was cut off before it finished." },
    ]);
    expect(summary.all).toEqual({ correct: 27, total: 54 });
    expect(summary.misses).toEqual([]);
    expect(summary.checks.wrongValues).toBe(0);
  });

  it("an empty run has no score", () => {
    expect(percent(summarize([]).all)).toBe("n/a");
  });
});

describe("readCostUsd", () => {
  it("prices tokens in and out per million", () => {
    const usage = { input_tokens: 5_000, output_tokens: 1_000 };
    expect(readCostUsd("sonnet", usage)).toBeCloseTo(0.02, 10); // 5,000 × $2 + 1,000 × $10, per million
    expect(readCostUsd("haiku", usage)).toBeCloseTo(0.001, 10); // 5,000 × $0.10 + 1,000 × $0.50
  });
});
