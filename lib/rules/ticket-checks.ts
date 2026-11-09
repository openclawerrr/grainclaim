/**
 * Checks on the values read from one ticket. A read value's confidence comes
 * from checks we can explain, not from the model rating itself: a misread
 * digit in gross, tare or net breaks "gross − tare = net".
 *
 * Each check uses only the values it names, so a failure points at them.
 * A check whose values weren't all read is "not_checked", never a pass.
 * Bushels and shrink are compared at the two decimals tickets print.
 */
import { CROPS, STANDARD_WEIGHT_LB, type Crop } from "./crops";
import { netWeightLb, wetBushels } from "./ticket";

/** The read values the checks use. Null means the value wasn't read. */
export interface TicketCheckInput {
  ticket_date: string | null;
  crop: string | null;
  gross_lbs: number | null;
  tare_lbs: number | null;
  net_lbs: number | null;
  wet_bu: number | null;
  moisture_pct: number | null;
  base_moisture_pct: number | null;
  shrink_pct_per_point: number | null;
  shrink_pct: number | null;
  elevator_dry_bu: number | null;
}
export type CheckedField = keyof TicketCheckInput;

/** Harvest dates for the crop year: later than `after`, and no later than `through`. Both YYYY-MM-DD. */
export interface HarvestWindow {
  /** The day planting finished. */
  after: string;
  /** The last day a harvest ticket can carry, such as December 31 of the crop year. */
  through: string;
}

export const TICKET_CHECK_IDS = ["net_weight", "wet_bushels", "harvest_date", "shrink", "dry_bushels"] as const;
export type TicketCheckId = (typeof TICKET_CHECK_IDS)[number];

export interface TicketCheck {
  id: TicketCheckId;
  status: "pass" | "fail" | "not_checked";
  /** The read values this check compares. A failure means at least one of them is wrong. */
  fields: CheckedField[];
  /** One plain sentence saying what was compared and what was found. */
  message: string;
}

const LABELS: Record<CheckedField, string> = {
  ticket_date: "the date",
  crop: "the crop",
  gross_lbs: "gross weight",
  tare_lbs: "tare weight",
  net_lbs: "net weight",
  wet_bu: "bushels",
  moisture_pct: "moisture",
  base_moisture_pct: "the buyer's base moisture",
  shrink_pct_per_point: "the buyer's shrink rate",
  shrink_pct: "shrink",
  elevator_dry_bu: "dry bushels",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rounds to `places` decimals the way tickets print (half up, for our positive values). */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor * (1 + Number.EPSILON)) / factor;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const isCrop = (value: string | null): value is Crop => CROPS.includes(value as Crop);
const usable = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function listOf(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The result for a check that can't run because some of its values weren't read. */
function notChecked(id: TicketCheckId, fields: CheckedField[], missing: CheckedField[], what: string): TicketCheck {
  const wasnt = missing.length === 1 ? "wasn't" : "weren't";
  return {
    id,
    status: "not_checked",
    fields,
    message: `${capitalize(what)} can't be checked because ${listOf(missing.map((f) => LABELS[f]))} ${wasnt} read.`,
  };
}

/** Gross − tare = net. */
function checkNetWeight(t: TicketCheckInput): TicketCheck {
  const id = "net_weight";
  const fields: CheckedField[] = ["gross_lbs", "tare_lbs", "net_lbs"];
  const missing = fields.filter((f) => !usable(t[f] as number | null));
  if (missing.length > 0) return notChecked(id, fields, missing, "net weight");

  const [gross, tare, net] = [t.gross_lbs!, t.tare_lbs!, t.net_lbs!];
  if (tare > gross) {
    return {
      id,
      status: "fail",
      fields,
      message: `Tare reads ${fmt(tare)} lb, more than the gross weight of ${fmt(gross)} lb.`,
    };
  }
  const expected = netWeightLb(gross, tare);
  if (same(expected, net)) {
    return { id, status: "pass", fields, message: `Gross − tare = net (${fmt(net)} lb).` };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `Net weight reads ${fmt(net)} lb, but gross − tare is ${fmt(expected)} lb.`,
  };
}

/** Net ÷ the crop's standard weight = the bushels written on the ticket. */
function checkWetBushels(t: TicketCheckInput): TicketCheck {
  const id = "wet_bushels";
  const fields: CheckedField[] = ["net_lbs", "crop", "wet_bu"];
  const missing = fields.filter((f) => (f === "crop" ? !isCrop(t.crop) : !usable(t[f] as number | null)));
  if (missing.length > 0) return notChecked(id, fields, missing, "bushels");

  const crop = t.crop as Crop;
  const standard = STANDARD_WEIGHT_LB[crop];
  const expected = round(wetBushels(t.net_lbs!, crop), 2);
  if (same(expected, t.wet_bu!)) {
    return { id, status: "pass", fields, message: `Net ÷ ${standard} lb = ${fmt(expected)} bushels.` };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `Bushels read ${fmt(t.wet_bu!)}, but net ÷ ${standard} lb is ${fmt(expected)}.`,
  };
}

/** The ticket's date falls inside the crop year's harvest. */
function checkHarvestDate(t: TicketCheckInput, harvest: HarvestWindow): TicketCheck {
  const id = "harvest_date";
  const fields: CheckedField[] = ["ticket_date"];
  if (t.ticket_date === null) return notChecked(id, fields, fields, "the date");

  const date = t.ticket_date;
  const real = ISO_DATE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
  if (!real) {
    return { id, status: "fail", fields, message: `The date reads "${date}", which isn't a calendar date.` };
  }
  // YYYY-MM-DD strings sort in date order.
  if (date > harvest.after && date <= harvest.through) {
    return { id, status: "pass", fields, message: `The date (${date}) is inside this year's harvest.` };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `The date reads ${date}, outside this year's harvest (after ${harvest.after}, through ${harvest.through}).`,
  };
}

/** The buyer's rate × points of moisture over the base = this load's shrink. */
function checkShrink(t: TicketCheckInput): TicketCheck {
  const id = "shrink";
  const fields: CheckedField[] = ["moisture_pct", "base_moisture_pct", "shrink_pct_per_point", "shrink_pct"];
  const missing = fields.filter((f) => !usable(t[f] as number | null));
  if (missing.length > 0) return notChecked(id, fields, missing, "shrink");

  const points = Math.max(0, t.moisture_pct! - t.base_moisture_pct!);
  const expected = round(t.shrink_pct_per_point! * points, 2);
  if (same(expected, t.shrink_pct!)) {
    return {
      id,
      status: "pass",
      fields,
      message: `${fmt(t.shrink_pct_per_point!)}% × ${fmt(points)} points over ${fmt(t.base_moisture_pct!)}% = ${fmt(expected)}% shrink.`,
    };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `Shrink reads ${fmt(t.shrink_pct!)}%, but ${fmt(t.moisture_pct!)}% moisture at the buyer's rate gives ${fmt(expected)}%.`,
  };
}

/**
 * Bushels × (1 − shrink) = dry bushels. Buyers differ on whether they start
 * from the bushels as printed (two decimals) or from net ÷ standard weight
 * unrounded, so either one may match.
 */
function checkDryBushels(t: TicketCheckInput): TicketCheck {
  const id = "dry_bushels";
  const fields: CheckedField[] = ["wet_bu", "shrink_pct", "elevator_dry_bu"];
  const missing = fields.filter((f) => !usable(t[f] as number | null));
  if (missing.length > 0) return notChecked(id, fields, missing, "dry bushels");

  const keep = 1 - t.shrink_pct! / 100;
  const fromPrinted = round(t.wet_bu! * keep, 2);
  const candidates = [fromPrinted];
  if (usable(t.net_lbs) && isCrop(t.crop)) {
    candidates.push(round(wetBushels(t.net_lbs, t.crop) * keep, 2));
  }
  if (candidates.some((expected) => same(expected, t.elevator_dry_bu!))) {
    return {
      id,
      status: "pass",
      fields,
      message: `Bushels × (1 − ${fmt(t.shrink_pct!)}% shrink) = ${fmt(t.elevator_dry_bu!)} dry bushels.`,
    };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `Dry bushels read ${fmt(t.elevator_dry_bu!)}, but ${fmt(t.wet_bu!)} bushels less ${fmt(t.shrink_pct!)}% shrink is ${fmt(fromPrinted)}.`,
  };
}

/** Runs every check on one ticket's read values, in the order of TICKET_CHECK_IDS. */
export function checkTicket(ticket: TicketCheckInput, harvest: HarvestWindow): TicketCheck[] {
  return [
    checkNetWeight(ticket),
    checkWetBushels(ticket),
    checkHarvestDate(ticket, harvest),
    checkShrink(ticket),
    checkDryBushels(ticket),
  ];
}

/** The read values at least one failed check points at. */
export function fieldsInFailedChecks(checks: readonly TicketCheck[]): Set<CheckedField> {
  return new Set(checks.filter((c) => c.status === "fail").flatMap((c) => c.fields));
}

/** Every read value some check covers. A misread anywhere else can't be caught by arithmetic. */
export const CHECKED_FIELDS: readonly CheckedField[] = Object.keys(LABELS) as CheckedField[];
