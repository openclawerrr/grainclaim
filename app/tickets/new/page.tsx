import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AddTicket } from "@/components/tickets/add-ticket-form";
import { getCurrentRole } from "@/lib/role/current-role";

export const metadata: Metadata = { title: "Add ticket · GrainClaim" };

export default function AddTicketPage() {
  return (
    <div className="p-6">
      {/* The role comes from a cookie at request time, so the screen loads inside a boundary. */}
      <Suspense fallback={null}>
        <FarmerOnly>
          <AddTicket />
        </FarmerOnly>
      </Suspense>
    </div>
  );
}

/** Adding tickets is the farmer's job; the agent sees the finished report. */
async function FarmerOnly({ children }: { children: React.ReactNode }) {
  if ((await getCurrentRole()) !== "farmer") redirect("/");
  return children;
}
