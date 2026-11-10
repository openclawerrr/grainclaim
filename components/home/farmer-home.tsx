import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The farmer's home screen: his two actions, the season totals and Needs
 * attention on the left, the farm map on the right (docs/spec.md Part 11,
 * docs/design.md). Everything here is a placeholder until its screen is built;
 * no figure is shown that the database didn't produce.
 */
export function FarmerHome() {
  return (
    <div className="grid min-h-full grid-cols-[30rem_minmax(0,1fr)] gap-6 p-6">
      <h1 className="sr-only">Farmer home</h1>

      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              {/* One main button per screen; Add ticket is the quieter one. */}
              <Button disabled className="h-14 rounded-xl text-base font-semibold">
                Start harvesting
              </Button>
              <Button disabled variant="outline" className="h-14 rounded-xl bg-card text-base font-semibold">
                Add ticket
              </Button>
            </div>
            <p className="text-sm text-ink-muted">These turn on when their screens are built.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Season totals</CardTitle>
            <CardDescription>Fills in as tickets are added.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Total label="Unit 1 bushels" detail="of — guarantee" />
            <Total label="Unit 2 bushels" detail="of — guarantee" />
            <Total label="Loads today" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base text-ink-muted">
              Anything that needs a look will be listed here, each with its fix.
            </p>
          </CardContent>
        </Card>
      </div>

      <section
        aria-label="Farm map"
        className="flex min-h-[32rem] flex-col items-center justify-center gap-1 rounded-2xl bg-green-100 p-6 text-center ring-1 ring-line"
      >
        <h2 className="text-lg font-semibold text-ink">Farm map</h2>
        <p className="text-base text-ink-muted">Your fields will show here, outlined over the satellite picture.</p>
      </section>
    </div>
  );
}

/** A big number with a small label. The number is a dash until it's calculated. */
function Total({ label, detail }: { label: string; detail?: string }) {
  return (
    <div>
      <p className="font-heading text-4xl font-semibold tabular-nums text-ink">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not available yet</span>
      </p>
      <p className="mt-1 text-sm font-medium text-ink">{label}</p>
      {detail ? <p className="text-sm text-ink-muted tabular-nums">{detail}</p> : null}
    </div>
  );
}
