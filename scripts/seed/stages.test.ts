import { describe, expect, it } from "vitest";
import { parseSeedArgs } from "./args";
import { DELETE_ORDER } from "./reset";
import { loadSampleFiles } from "./sample-files";
import { STAGE_NAMES, STAGES, stagesThrough } from "./stages";
import { expectedCounts } from "./verify";

const files = loadSampleFiles();

describe("stages", () => {
  it("run farm-base, then fields, then season-2026", () => {
    expect(STAGE_NAMES).toEqual(["farm-base", "fields", "season-2026"]);
  });

  it("--through farm-base loads everything except the fields and the season (demo beat 1)", () => {
    expect(expectedCounts(stagesThrough("farm-base"), files)).toMatchObject({
      insured: 1,
      buyer: 1,
      bin: 2,
      truck: 2,
      field: 0,
      policy: 0,
      unit: 0,
      field_season: 0,
    });
  });

  it("all stages load the whole sample farm", () => {
    expect(expectedCounts(STAGES, files)).toEqual({
      flag: 0,
      ticket: 0,
      trip: 0,
      field_season: 2,
      unit: 2,
      policy: 1,
      truck: 2,
      bin: 2,
      field: 2,
      buyer: 1,
      insured: 1,
    });
  });

  it("only write to tables the reset knows how to clear", () => {
    for (const stage of STAGES) {
      for (const table of Object.keys(stage.rows(files))) {
        expect(DELETE_ORDER).toContain(table);
      }
    }
  });

  it("reject an unknown stage", () => {
    expect(() => stagesThrough("harvest")).toThrow('Unknown stage "harvest"');
  });
});

describe("parseSeedArgs", () => {
  const parse = (...argv: string[]) => parseSeedArgs(argv, STAGE_NAMES);

  it("loads every stage by default", () => {
    expect(parse()).toEqual({ kind: "load", through: "season-2026" });
  });

  it("reads --through in both forms", () => {
    expect(parse("--through", "farm-base")).toEqual({ kind: "load", through: "farm-base" });
    expect(parse("--through=fields")).toEqual({ kind: "load", through: "fields" });
  });

  it("reads --reset-only, --list and --help", () => {
    expect(parse("--reset-only")).toEqual({ kind: "reset-only" });
    expect(parse("--list")).toEqual({ kind: "list" });
    expect(parse("--help")).toEqual({ kind: "help" });
  });

  it("rejects unknown stages, unknown options, a missing stage name and two commands", () => {
    expect(() => parse("--through", "harvest")).toThrow('Unknown stage "harvest"');
    expect(() => parse("--fast")).toThrow('Unknown option "--fast"');
    expect(() => parse("--through")).toThrow("--through needs a stage name");
    expect(() => parse("--reset-only", "--through", "fields")).toThrow("Use only one of");
  });
});
