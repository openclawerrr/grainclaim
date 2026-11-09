/**
 * Checks sample-data/documents-2026.json before anything is printed: every
 * printed result agrees with lib/rules, the documents agree with each other,
 * and they agree with the sample farm and season the seed loads. Pure: plain
 * data in, one sentence per problem out.
 *
 * The demo's deliberate differences (80.00 acres on the Summary of Coverage,
 * a ticket missing from the settlement) are not problems here; the tests in
 * documents.test.ts pin them to spec Part 9.
 */
import { RuleInputError } from "../../lib/rules/errors";
import { elevatorDryBushels, netWeightLb, wetBushels } from "../../lib/rules/ticket";
import { guaranteeBushels } from "../../lib/rules/unit";
import type { SampleFiles } from "../seed/sample-files";
import { documentsOfKind, type DocumentsFile, type TicketDoc } from "./documents-file";

/** Rounds to `places` decimals the way the documents print (half away from zero for our positive values). */
export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor * (1 + Number.EPSILON)) / factor;
}

const differs = (a: number, b: number) => Math.abs(a - b) > 1e-9;
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

const NAME_PATTERNS: Record<DocumentsFile["documents"][string]["kind"], RegExp> = {
  scale_ticket: /^ticket-\d+$/,
  fsa_578: /^fsa-578(-\d+)?$/,
  summary_of_coverage: /^summary-of-coverage(-\d+)?$/,
  settlement: /^settlement(-\d+)?$/,
};

export function findDocumentProblems(file: DocumentsFile, sample: SampleFiles): string[] {
  const problems: string[] = [];
  const { farm, fields, season } = sample;
  const policy = season.policy;

  if (file.crop_year !== policy.crop_year) {
    problems.push(`The documents are for ${file.crop_year} but season-2026.json is for ${policy.crop_year}.`);
  }
  for (const [name, doc] of Object.entries(file.documents)) {
    if (!NAME_PATTERNS[doc.kind].test(name)) {
      problems.push(`${name}: a ${doc.kind} document must be named like ${NAME_PATTERNS[doc.kind].source}.`);
    }
  }

  const tickets = documentsOfKind(file, "scale_ticket");
  problems.push(...ticketProblems(tickets, sample));

  for (const [name, { values: v }] of documentsOfKind(file, "settlement")) {
    const say = (msg: string) => problems.push(`${name}: ${msg}`);
    const buyer = farm.buyers.find((b) => b.name === v.buyer_name);
    if (!buyer) say(`buyer "${v.buyer_name}" is not in farm.json.`);
    else if (buyer.address !== v.buyer_address) say(`the buyer's address differs from farm.json.`);
    if (v.customer !== farm.insured.name) say(`the customer should be "${farm.insured.name}".`);
    if (v.payee !== farm.insured.name) say(`the payee should be "${farm.insured.name}".`);
    if (v.crop !== policy.crop) say(`the grain is ${v.crop} but the policy is ${policy.crop}.`);
    if (differs(v.price_per_bu, round(v.futures_price + v.basis, 2))) {
      say(`price ${v.price_per_bu} is not futures ${v.futures_price} + basis ${v.basis}.`);
    }

    const seen = new Set<string>();
    for (const line of v.tickets) {
      if (seen.has(line.ticket_number)) say(`ticket ${line.ticket_number} is listed twice.`);
      seen.add(line.ticket_number);

      const match = tickets.find(([, t]) => t.values.ticket_number === line.ticket_number);
      if (!match) {
        say(`ticket ${line.ticket_number} is not one of the ticket documents.`);
        continue;
      }
      const [ticketName, { values: t }] = match;
      for (const key of ["ticket_date", "net_lbs", "moisture_pct", "wet_bu", "shrink_pct", "elevator_dry_bu"] as const) {
        if (line[key] !== t[key]) say(`ticket ${line.ticket_number} shows ${key} ${line[key]} but ${ticketName} shows ${t[key]}.`);
      }
      if (t.buyer_name !== v.buyer_name) say(`ticket ${line.ticket_number} is from ${t.buyer_name}, not ${v.buyer_name}.`);
      if (t.contract_number !== v.contract_number) {
        say(`ticket ${line.ticket_number} is on contract ${t.contract_number}, not ${v.contract_number}.`);
      }
      if (t.base_moisture_pct !== v.base_moisture_pct || t.shrink_pct_per_point !== v.shrink_pct_per_point) {
        say(`ticket ${line.ticket_number} uses a different shrink from the settlement.`);
      }
      const drying = round(line.wet_bu * Math.max(0, line.moisture_pct - v.base_moisture_pct) * v.drying_per_point, 2);
      if (differs(line.drying_charge, drying)) {
        say(`ticket ${line.ticket_number}'s drying charge is ${line.drying_charge} but the rate gives ${drying}.`);
      }
    }

    const totals: [string, number, number][] = [
      ["total net lb", v.total_net_lbs, sum(v.tickets.map((l) => l.net_lbs))],
      ["total wet bu", v.total_wet_bu, round(sum(v.tickets.map((l) => l.wet_bu)), 2)],
      ["total dry bu", v.total_dry_bu, round(sum(v.tickets.map((l) => l.elevator_dry_bu)), 2)],
      ["drying total", v.drying_total, round(sum(v.tickets.map((l) => l.drying_charge)), 2)],
      ["gross amount", v.gross_amount, round(v.total_dry_bu * v.price_per_bu, 2)],
      ["checkoff", v.checkoff_total, round(v.total_dry_bu * v.checkoff_per_bu, 2)],
      ["net payment", v.net_payment, round(v.gross_amount - v.drying_total - v.checkoff_total, 2)],
    ];
    for (const [label, printed, expected] of totals) {
      if (differs(printed, expected)) say(`${label} is ${fmt(printed)} but should be ${fmt(expected)}.`);
    }
  }

  for (const [name, { values: v }] of documentsOfKind(file, "fsa_578")) {
    const say = (msg: string) => problems.push(`${name}: ${msg}`);
    if (v.program_year !== policy.crop_year) say(`program year ${v.program_year} is not ${policy.crop_year}.`);
    if (v.operator.name !== farm.insured.name) say(`the operator should be "${farm.insured.name}".`);
    const keys = new Set([v.operator.key, ...v.other_producers.map((p) => p.key)]);

    for (const line of v.fields) {
      const label = `tract ${line.tract} field ${line.field}`;
      const mapped = fields.find(
        ({ properties: p }) => p.fsa_farm === v.farm_number && p.fsa_tract === line.tract && p.fsa_field === line.field,
      );
      if (!mapped) {
        say(`${label} is not a field in farm.geojson.`);
        continue;
      }
      const fieldName = mapped.properties.name;
      if (differs(line.reported_acres, mapped.properties.expected_acres)) {
        say(`${fieldName} reports ${line.reported_acres} acres but the map measures ${mapped.properties.expected_acres}.`);
      }
      const shareTotal = round(sum(line.shares.map((s) => s.share)), 4);
      if (differs(shareTotal, 1)) say(`${fieldName}'s shares add up to ${shareTotal}, not 1.`);
      for (const s of line.shares) {
        if (!keys.has(s.key)) say(`${fieldName} has a share for key ${s.key}, which is not a producer on the form.`);
      }

      const fieldSeason = season.field_seasons.find((fs) => fs.field === fieldName);
      if (!fieldSeason) {
        say(`${fieldName} has no field season in season-2026.json.`);
        continue;
      }
      if (differs(fieldSeason.planted_acres, line.reported_acres)) {
        say(`${fieldName} reports ${line.reported_acres} acres but season-2026.json plants ${fieldSeason.planted_acres}.`);
      }
      if (fieldSeason.planting_date !== line.planting_date) {
        say(`${fieldName}'s planting date ${line.planting_date} differs from season-2026.json.`);
      }
      if (fieldSeason.crop !== line.crop) say(`${fieldName} is ${line.crop} but season-2026.json says ${fieldSeason.crop}.`);
      const unit = season.units.find((u) => u.unit_number === fieldSeason.unit);
      const operatorShare = line.shares.find((s) => s.key === v.operator.key)?.share;
      if (unit && operatorShare !== unit.insured_share) {
        say(`${fieldName} gives the operator a share of ${operatorShare} but Unit ${unit.unit_number}'s share is ${unit.insured_share}.`);
      }
    }

    for (const f of fields) {
      const p = f.properties;
      const listed = v.fields.some((line) => v.farm_number === p.fsa_farm && line.tract === p.fsa_tract && line.field === p.fsa_field);
      if (!listed) say(`${p.name} is on the map but not on the form, which would fire the unreported-acres flag.`);
    }
    const total = round(sum(v.fields.map((line) => line.reported_acres)), 2);
    if (differs(v.total_operator_report, total)) say(`the total operator report is ${v.total_operator_report} but the fields add up to ${total}.`);
    if (v.cropland_acres < total || v.farmland_acres < v.cropland_acres) {
      say(`farmland ≥ cropland ≥ reported acres doesn't hold.`);
    }
  }

  for (const [name, { values: v }] of documentsOfKind(file, "summary_of_coverage")) {
    const say = (msg: string) => problems.push(`${name}: ${msg}`);
    if (v.insured_name !== farm.insured.name) say(`the insured should be "${farm.insured.name}".`);
    const policyChecks = [
      ["policy number", v.policy_number, policy.policy_number],
      ["crop year", v.crop_year, policy.crop_year],
      ["crop", v.crop, policy.crop],
      ["state", v.state, policy.state],
      ["county", v.county, policy.county],
      ["plan", v.plan, policy.plan],
      ["coverage level", v.coverage_level, policy.coverage_level],
      ["price election", v.price_election, policy.price_election],
      ["unit structure", v.unit_structure, policy.unit_structure],
      ["projected price", v.projected_price, policy.projected_price],
    ] as const;
    for (const [label, printed, seeded] of policyChecks) {
      if (printed !== seeded) say(`${label} ${printed} differs from season-2026.json (${seeded}).`);
    }

    for (const unit of v.units) {
      const label = `Unit ${unit.unit_number}`;
      const seeded = season.units.find((u) => u.unit_number === unit.unit_number);
      if (!seeded) {
        say(`${label} is not in season-2026.json.`);
        continue;
      }
      if (unit.unit_type !== seeded.unit_type) say(`${label} is ${unit.unit_type} but season-2026.json says ${seeded.unit_type}.`);
      if (unit.practice !== seeded.practice) say(`${label}'s practice differs from season-2026.json.`);
      if (unit.insured_share !== seeded.insured_share) say(`${label}'s share ${unit.insured_share} differs from season-2026.json (${seeded.insured_share}).`);
      if (unit.approved_yield !== policy.approved_yield) say(`${label}'s approved yield differs from the policy's.`);

      const mapped = fields.find(
        ({ properties: p }) => p.fsa_farm === unit.fsa_farm && p.fsa_tract === unit.fsa_tract && p.fsa_field === unit.fsa_field,
      );
      const fieldSeason = mapped && season.field_seasons.find((fs) => fs.field === mapped.properties.name);
      if (!mapped) say(`${label}'s FSA number ${unit.fsa_farm}/${unit.fsa_tract}/${unit.fsa_field} is not a field in farm.geojson.`);
      else if (fieldSeason?.unit !== unit.unit_number) say(`${mapped.properties.name} is not in ${label} in season-2026.json.`);

      const guarantee = guaranteeBushels({
        approvedYield: unit.approved_yield,
        coverageLevel: v.coverage_level,
        acres: unit.acres,
        share: unit.insured_share,
      });
      const perAcre = round(unit.approved_yield * v.coverage_level, 1);
      if (differs(unit.guarantee_bu_per_acre, perAcre)) say(`${label}'s guarantee per acre should be ${perAcre}.`);
      if (unit.guarantee_bu !== Math.round(guarantee)) say(`${label}'s guarantee should be ${Math.round(guarantee)} bu.`);
      const liability = Math.round(guarantee * v.projected_price * v.price_election);
      if (unit.liability !== liability) say(`${label}'s liability should be $${liability}.`);
    }
    for (const seeded of season.units) {
      if (!v.units.some((u) => u.unit_number === seeded.unit_number)) say(`Unit ${seeded.unit_number} is missing.`);
    }
    const totals: [string, number, number][] = [
      ["total acres", v.total_acres, round(sum(v.units.map((u) => u.acres)), 2)],
      ["total guarantee", v.total_guarantee_bu, sum(v.units.map((u) => u.guarantee_bu))],
      ["total liability", v.total_liability, sum(v.units.map((u) => u.liability))],
    ];
    for (const [label, printed, expected] of totals) {
      if (differs(printed, expected)) say(`${label} is ${fmt(printed)} but the units add up to ${fmt(expected)}.`);
    }
  }

  return problems;
}

function ticketProblems(tickets: [string, TicketDoc][], { farm, season }: SampleFiles): string[] {
  const problems: string[] = [];
  const plantingDone = season.field_seasons.map((fs) => fs.planting_completed_date).sort().at(-1) ?? "";

  const numbers = tickets.map(([, t]) => t.values.ticket_number);
  for (const n of new Set(numbers.filter((x, i) => numbers.indexOf(x) !== i))) {
    problems.push(`Ticket number ${n} is used on more than one ticket.`);
  }

  for (const [name, { values: v }] of tickets) {
    const say = (msg: string) => problems.push(`${name}: ${msg}`);
    const buyer = farm.buyers.find((b) => b.name === v.buyer_name);
    if (!buyer) say(`buyer "${v.buyer_name}" is not in farm.json.`);
    else if (buyer.address !== v.buyer_address) say(`the buyer's address differs from farm.json.`);
    if (v.customer !== farm.insured.name) say(`the customer should be "${farm.insured.name}".`);
    if (v.crop !== season.policy.crop) say(`the grain is ${v.crop} but the policy is ${season.policy.crop}.`);
    if (!v.ticket_date.startsWith(`${season.policy.crop_year}-`) || v.ticket_date <= plantingDone) {
      say(`dated ${v.ticket_date}, outside the ${season.policy.crop_year} harvest.`);
    }
    if (v.purchase_type === "contract" && !v.contract_number) say(`a contract purchase needs a contract number.`);

    const truck = farm.trucks.find((t) => t.name === `Truck ${v.truck_number}`);
    if (!truck) say(`truck ${v.truck_number} is not a truck in farm.json.`);
    else if (v.wet_bu > truck.capacity_bu) {
      say(`${truck.name} holds ${fmt(truck.capacity_bu)} bu but the ticket shows ${fmt(v.wet_bu)}.`);
    }

    try {
      const net = netWeightLb(v.gross_lbs, v.tare_lbs);
      if (net !== v.net_lbs) say(`net weight is ${fmt(v.net_lbs)} lb but gross − tare is ${fmt(net)} lb.`);

      const wet = wetBushels(v.net_lbs, v.crop);
      if (differs(v.wet_bu, round(wet, 2))) say(`bushels are ${v.wet_bu} but net ÷ standard weight is ${round(wet, 2)}.`);

      const shrink = round(v.shrink_pct_per_point * Math.max(0, v.moisture_pct - v.base_moisture_pct), 2);
      if (differs(v.shrink_pct, shrink)) say(`shrink is ${v.shrink_pct}% but the buyer's rate gives ${shrink}%.`);

      const dry = round(
        elevatorDryBushels(wet, v.moisture_pct, {
          baseMoisturePct: v.base_moisture_pct,
          shrinkPctPerPoint: v.shrink_pct_per_point,
        }),
        2,
      );
      if (differs(v.elevator_dry_bu, dry)) say(`dry bushels are ${v.elevator_dry_bu} but lib/rules gives ${dry}.`);
    } catch (err) {
      if (!(err instanceof RuleInputError)) throw err;
      say(err.message);
    }
  }
  return problems;
}
