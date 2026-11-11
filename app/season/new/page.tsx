import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SeasonSetup } from "@/components/season/season-setup";
import { getCurrentRole } from "@/lib/role/current-role";

export const metadata: Metadata = { title: "Set up your season · GrainClaim" };

export default function SeasonSetupPage() {
  return (
    <div className="p-6">
      {/* The role comes from a cookie at request time, so the screen loads inside a boundary. */}
      <Suspense fallback={null}>
        <FarmerOnly>
          <SeasonSetup />
        </FarmerOnly>
      </Suspense>
    </div>
  );
}

/** Setting up a season is the farmer's job; the agent sees the finished report. */
async function FarmerOnly({ children }: { children: React.ReactNode }) {
  if ((await getCurrentRole()) !== "farmer") redirect("/");
  return children;
}
