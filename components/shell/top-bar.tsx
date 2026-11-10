import { Suspense } from "react";
import Link from "next/link";
import { Wheat } from "lucide-react";
import { RoleSwitcher, RoleSwitcherFallback } from "./role-switcher";

/**
 * Placeholder, the same name the seed loads. Replace it with the insured's
 * name from the database when `lib/db/` exists (Milestone 2).
 */
const FARM_NAME_PLACEHOLDER = "Dave's Farm (SAMPLE)";

export function TopBar() {
  return (
    <header className="flex h-16 shrink-0 items-center border-b border-line bg-card pr-6">
      <Link href="/" className="flex h-full items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {/* As wide as the icon rail below, so the mark lines up with its icons. */}
        <span className="flex w-16 justify-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-green-700 text-white">
            <Wheat className="size-5" aria-hidden="true" />
          </span>
        </span>
        <span className="font-heading text-xl font-semibold tracking-tight text-ink">GrainClaim</span>
      </Link>

      <span className="mx-5 h-6 w-px bg-line" aria-hidden="true" />
      <p className="text-base font-medium text-ink">{FARM_NAME_PLACEHOLDER}</p>

      <div className="ml-auto">
        {/* The role is read from a cookie at request time, so it loads here. */}
        <Suspense fallback={<RoleSwitcherFallback />}>
          <RoleSwitcher />
        </Suspense>
      </div>
    </header>
  );
}
