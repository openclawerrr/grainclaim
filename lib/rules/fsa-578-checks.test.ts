import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import {
  checkFsa578,
  fsaFieldLabels,
  fsaProducerLabels,
  fsaShareLabels,
  type Fsa578CheckInput,
} from "./fsa-578-checks";

// The SAMPLE FSA-578 as printed in the answer key.
const FORM: Fsa578CheckInput = documentsOfKind(loadDocumentsFile(), "fsa_578")[0][1].values;
const NORTH = "field 1234/5678/3";
const SOUTH = "field 1234/6012/1";

type Line = Fsa578CheckInput["fields"][number];
/** The sample form with one field line changed: 0 is North 80, 1 is South 40. */
const withLine = (index: number, changes: Partial<Line>): Fsa578CheckInput => ({
  ...FORM,
  fields: FORM.fields.map((line, i) => (i === index ? { ...line, ...changes } : line)),
});
const failed = (form: Fsa578CheckInput) => checkFsa578(form).filter((c) => c.status === "fail");
const check = (form: Fsa578CheckInput, id: string, nth = 0) => checkFsa578(form).filter((c) => c.id === id)[nth];

describe("naming the rows", () => {
  it("names a field line by its farm, tract and field number", () => {
    expect(fsaFieldLabels(FORM)).toEqual([NORTH, SOUTH]);
    expect(fsaFieldLabels({ farm_number: null, fields: [{ ...FORM.fields[0], tract: null }] })).toEqual(["field ?/?/3"]);
  });

  it("names a share by its producer key, and another producer by key", () => {
    expect(fsaShareLabels(SOUTH, FORM.fields[1].shares)).toEqual([`${SOUTH} share 1`, `${SOUTH} share 2`]);
    expect(fsaProducerLabels(FORM.other_producers)).toEqual(["producer 2"]);
  });
});

describe("the sample FSA-578", () => {
  it("passes every check", () => {
    const checks = checkFsa578(FORM);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["shares", "pass"],
      ["shares", "pass"],
      ["share_keys", "pass"],
      ["acres_total", "pass"],
      ["cropland", "pass"],
      ["reported_acres", "pass"],
      ["planting_date", "pass"],
      ["planting_date", "pass"],
      ["certification_date", "pass"],
    ]);
    expect(checks.map((c) => c.message)).toEqual([
      "Field 1234/5678/3's shares add up to 1.",
      "Field 1234/6012/1's shares add up to 1.",
      "Every share belongs to a producer listed on the form.",
      "Reported acres add up to the operator total (120.2 acres).",
      "Cropland (120.2 acres) fits inside farmland (126.7 acres).",
      "Reported acres (120.2) fit inside farmland (126.7 acres).",
      "Field 1234/5678/3 was planted 2026-04-28, in time for the 2026 program year.",
      "Field 1234/6012/1 was planted 2026-04-28, in time for the 2026 program year.",
      "The certification date (2026-06-12) fits the 2026 program year.",
    ]);
  });
});

describe("shares", () => {
  it("catches a misread share and points at that field's shares", () => {
    const misread = withLine(1, { shares: [{ key: "1", share: 0.6661 }, { key: "2", share: 0.3333 }] });
    expect(failed(misread)).toEqual([
      {
        id: "shares",
        status: "fail",
        fields: [`${SOUTH} share 1: share`, `${SOUTH} share 2: share`],
        message: "Field 1234/6012/1's shares add up to 0.9994, not 1.",
      },
    ]);
  });

  it("lets thirds printed to four decimals add up to 1", () => {
    const thirds = [1, 2, 3].map((key) => ({ key: String(key), share: 0.3333 }));
    const form = { ...withLine(1, { shares: thirds }), other_producers: [{ key: "2" }, { key: "3" }] };
    expect(failed(form)).toEqual([]);
  });

  it("isn't checked when a share or every share is unread", () => {
    const blank = check(withLine(1, { shares: [{ key: "1", share: null }, { key: "2", share: 0.3333 }] }), "shares", 1);
    expect(blank.status).toBe("not_checked");
    expect(blank.message).toBe(
      "Field 1234/6012/1's shares can't be checked because field 1234/6012/1 share 1: share wasn't read.",
    );
    expect(check(withLine(1, { shares: [] }), "shares", 1).message).toBe(
      "Field 1234/6012/1's shares can't be checked because none were read.",
    );
  });
});

describe("share keys", () => {
  it("catches a share for a key that isn't a producer on the form", () => {
    const stranger = withLine(1, { shares: [{ key: "1", share: 0.6667 }, { key: "7", share: 0.3333 }] });
    expect(failed(stranger).map((c) => [c.id, c.message])).toEqual([
      ["share_keys", "Field 1234/6012/1 has a share for key 7, which isn't a producer listed on the form."],
    ]);
    expect(failed(stranger)[0].fields).toContain(`${SOUTH} share 7: key`);
    expect(failed(stranger)[0].fields).toContain("producer 2: key");
  });

  it("isn't checked when a key is unread or there are no shares", () => {
    expect(check({ ...FORM, operator: { key: null } }, "share_keys").message).toBe(
      "Share keys can't be checked because operator: key wasn't read.",
    );
    expect(check({ ...FORM, fields: [] }, "share_keys").status).toBe("not_checked");
  });
});

describe("acres", () => {
  it("catches reported acres that don't add up to the operator total", () => {
    const misread = withLine(0, { reported_acres: 60.2 });
    expect(failed(misread).map((c) => [c.id, c.message])).toEqual([
      ["acres_total", "The operator total reads 120.2 acres, but the fields' reported acres add up to 100.2."],
    ]);
    expect(failed(misread)[0].fields).toEqual([`${NORTH}: reported_acres`, `${SOUTH}: reported_acres`, "total_operator_report"]);
  });

  it("isn't checked without the total, an acre value or any field", () => {
    expect(check({ ...FORM, total_operator_report: null }, "acres_total").status).toBe("not_checked");
    expect(check(withLine(0, { reported_acres: null }), "acres_total").message).toBe(
      "The operator total can't be checked because field 1234/5678/3: reported_acres wasn't read.",
    );
    expect(check({ ...FORM, fields: [] }, "acres_total").message).toBe(
      "The operator total can't be checked because no fields were read.",
    );
  });

  it("catches cropland larger than farmland", () => {
    expect(failed({ ...FORM, cropland_acres: 190.2 }).map((c) => [c.id, c.message])).toEqual([
      ["cropland", "Cropland reads 190.2 acres, more than the farm's 126.7 acres of farmland."],
    ]);
    expect(check({ ...FORM, farmland_acres: null }, "cropland").status).toBe("not_checked");
  });

  it("catches first crops reported on more ground than the farm has", () => {
    const form = { ...withLine(0, { reported_acres: 180.2 }), total_operator_report: 220.2 };
    expect(failed(form).map((c) => [c.id, c.message])).toEqual([
      ["reported_acres", "The operator total reads 220.2 acres, more than the farm's 126.7 acres of farmland."],
    ]);
  });

  it("doesn't compare reported acres with farmland when a second crop is on the same ground", () => {
    const doubleCrop = check(withLine(1, { crop_status: "D" }), "reported_acres");
    expect(doubleCrop.status).toBe("not_checked");
    expect(doubleCrop.message).toBe(
      "Reported acres can't be checked against farmland because a second crop is reported on the same ground.",
    );
    expect(check(withLine(1, { crop_status: null }), "reported_acres").status).toBe("not_checked");
  });
});

describe("dates", () => {
  const planting = (planting_date: string | null) => check(withLine(0, { planting_date }), "planting_date");

  it("takes a planting date in the program year or the fall before it", () => {
    expect(planting("2025-10-03").status).toBe("pass");
    expect(planting("2028-04-28")).toMatchObject({
      status: "fail",
      message: "Field 1234/5678/3's planting date reads 2028-04-28, outside the 2026 program year.",
    });
    expect(planting("2024-10-03").status).toBe("fail");
  });

  it("catches a planting date after the form was certified, and one that isn't a date", () => {
    expect(planting("2026-09-28").message).toBe(
      "Field 1234/5678/3's planting date reads 2026-09-28, after the form was certified on 2026-06-12.",
    );
    expect(planting("2026-02-30").message).toBe(
      'Field 1234/5678/3\'s planting date reads "2026-02-30", which isn\'t a calendar date.',
    );
    expect(planting("2026-04-28").fields).toEqual([`${NORTH}: planting_date`, "program_year", "certification_date"]);
  });

  it("isn't checked without the planting date or the program year", () => {
    expect(planting(null).status).toBe("not_checked");
    expect(check({ ...FORM, program_year: null }, "planting_date").status).toBe("not_checked");
    // A planting date still passes on its own when the certification date wasn't read.
    expect(check({ ...FORM, certification_date: null }, "planting_date").status).toBe("pass");
  });

  it("takes a certification date within a year of the program year", () => {
    const certified = (certification_date: string | null) => check({ ...FORM, certification_date }, "certification_date");
    expect(certified("2025-12-10").status).toBe("pass");
    expect(certified("2027-01-15").status).toBe("pass");
    expect(certified("2029-06-12").message).toBe(
      "The certification date reads 2029-06-12, which doesn't fit the 2026 program year.",
    );
    expect(certified("06-12-2026").status).toBe("fail");
    expect(certified(null).status).toBe("not_checked");
  });
});
