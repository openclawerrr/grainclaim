import { Suspense } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FarmMapLoading, FarmMapPanel } from "@/components/map/farm-map-panel";
import { cn } from "@/lib/utils";
import { SeasonTotals, SeasonTotalsLoading } from "./season-totals";

/**
 * The farmer's home screen: his two actions, the season totals and Needs
 * attention on the left, the farm map on the right (docs/spec.md Part 11,
 * docs/design.md). Add ticket, the unit totals and the map (with adding a
 * bin) are real. The rest is a placeholder until its screen is built; no
 * figure is shown that the database didn't produce.
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
              <Link
                href="/tickets/new"
                className={cn(buttonVariants({ variant: "outline" }), "h-14 rounded-xl bg-card text-base font-semibold")}
              >
                Add ticket
              </Link>
            </div>
            <p className="text-sm text-ink-muted">Start harvesting turns on when its screen is built.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Season totals</CardTitle>
            <CardDescription>Production to count for insurance, from your tickets.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Suspense fallback={<SeasonTotalsLoading />}>
              <SeasonTotals />
            </Suspense>
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

      <section aria-label="Farm map" className="flex min-h-[32rem] flex-col overflow-hidden rounded-2xl bg-green-100 ring-1 ring-line">
        <h2 className="sr-only">Farm map</h2>
        <Suspense fallback={<FarmMapLoading />}>
          <FarmMapPanel />
        </Suspense>
      </section>
    </div>
  );
}
