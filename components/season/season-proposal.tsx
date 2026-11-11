import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAcres, formatDate, formatPercent, formatWholeBushels } from "@/lib/format";
import type { ProposedUnit, SeasonProposal } from "@/lib/rules/season-setup";
import { cn } from "@/lib/utils";

const PLAN_NAMES: Record<string, string> = {
  RP: "Revenue Protection",
  "RP-HPE": "Revenue Protection with Harvest Price Exclusion",
  YP: "Yield Protection",
};
const STATE_NAMES: Record<string, string> = { IA: "Iowa" };

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const dollars = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "2026 corn in Story County, Iowa" */
export function seasonTitle({ policy }: SeasonProposal): string {
  return `${policy.crop_year} ${policy.crop} in ${policy.county} County, ${STATE_NAMES[policy.state] ?? policy.state}`;
}

/** The farmer's share in his words: all his, or his part of a crop share. */
function shareWords(unit: ProposedUnit): string {
  return unit.shareArrangement === "crop_share"
    ? `Crop share: ${formatPercent(unit.insuredShare * 100)} yours`
    : "100% yours";
}

/**
 * The season two documents describe: the policy, each unit with its field,
 * acres, share and guarantee, and what needs a look. The same view before
 * and after the farmer confirms. Guarantees are rounded here and nowhere
 * else.
 */
export function SeasonProposalView({ proposal, warnings = [] }: { proposal: SeasonProposal; warnings?: string[] }) {
  const { policy, units, flags } = proposal;
  return (
    <div className="flex flex-col gap-4">
      {flags.length > 0 ? (
        <section aria-label="Needs a look" className="rounded-2xl bg-yellow-100 px-6 py-4 ring-1 ring-line">
          <h2 className="text-base font-semibold text-ink">Needs a look</h2>
          <ul className="mt-1 flex flex-col gap-1">
            {flags.map((flag) => (
              <li key={flag.message} className="text-base text-ink">
                {flag.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section aria-label="Check these values" className="rounded-2xl bg-yellow-100 px-6 py-4 ring-1 ring-line">
          <h2 className="text-base font-semibold text-ink">Check these against your documents</h2>
          <ul className="mt-1 flex flex-col gap-1">
            {warnings.map((warning) => (
              <li key={warning} className="text-base text-ink">
                {warning}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Policy</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-5 gap-4">
            <Fact label="Plan" value={PLAN_NAMES[policy.plan] ?? policy.plan} />
            <Fact label="Coverage level" value={formatPercent(policy.coverage_level * 100)} />
            <Fact label="Approved yield" value={`${formatWholeBushels(policy.approved_yield)} bu per acre`} />
            <Fact label="Projected price" value={policy.projected_price === null ? "Not shown" : `${dollars(policy.projected_price)} per bu`} />
            <Fact label="Policy number" value={policy.policy_number ?? "Not shown"} />
          </dl>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {units.map((unit) => (
          <UnitCard key={unit.unitNumber} unit={unit} proposal={proposal} />
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-base font-medium text-ink">{value}</dd>
    </div>
  );
}

function UnitCard({ unit, proposal }: { unit: ProposedUnit; proposal: SeasonProposal }) {
  const { policy } = proposal;
  const acresDiffer = unit.coverageAcres !== null && formatAcres(unit.coverageAcres) !== formatAcres(unit.plantedAcres);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Unit {unit.unitNumber}</CardTitle>
        <p className="text-sm text-ink-muted">
          {capitalize(unit.unitType)} unit · {shareWords(unit)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="font-heading text-4xl font-semibold tabular-nums text-ink">{formatWholeBushels(unit.guaranteeBu)}</p>
          <p className="mt-1 text-sm font-medium text-ink">Bushels guaranteed</p>
          <p className="text-sm text-ink-muted tabular-nums">
            {formatWholeBushels(policy.approved_yield)} bu per acre × {formatPercent(policy.coverage_level * 100)} ×{" "}
            {formatAcres(unit.plantedAcres)} acres × {formatPercent(unit.insuredShare * 100)} share
          </p>
        </div>

        {unit.fields.length === 0 ? (
          <p className="rounded-xl bg-yellow-100 px-4 py-3 text-base text-ink">
            This unit&apos;s field isn&apos;t on your FSA-578, so it has no planted acres yet.
          </p>
        ) : (
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-line text-sm text-ink-muted">
                <th scope="col" className="py-2 font-medium">Field</th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">FSA-578 acres</th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">Summary of Coverage</th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">Map</th>
                <th scope="col" className="py-2 pl-4 font-medium">Planted</th>
              </tr>
            </thead>
            <tbody>
              {unit.fields.map((field) => (
                <tr key={field.fieldId} className="text-ink">
                  <th scope="row" className="py-2 font-semibold">{field.fieldName}</th>
                  <td className="py-2 pl-4 text-right tabular-nums">{formatAcres(field.plantedAcres)}</td>
                  <td className="py-2 pl-4 text-right tabular-nums">
                    <span className={cn(acresDiffer && "rounded-md bg-yellow-100 px-1.5 py-0.5 font-semibold")}>
                      {unit.coverageAcres === null ? "Not shown" : formatAcres(unit.coverageAcres)}
                    </span>
                  </td>
                  <td className="py-2 pl-4 text-right tabular-nums">
                    {field.mappedAcres === null ? "Not measured" : formatAcres(field.mappedAcres)}
                  </td>
                  <td className="py-2 pl-4">{field.plantingDate ? formatDate(field.plantingDate) : "Not shown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
