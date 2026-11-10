import { Suspense } from "react";
import { AgentHome } from "@/components/home/agent-home";
import { FarmerHome } from "@/components/home/farmer-home";
import { getCurrentRole } from "@/lib/role/current-role";

export default function HomePage() {
  // The role comes from a cookie at request time, so the home screen loads
  // inside a boundary. Nothing shows in its place: the two home screens have
  // different shapes, and the wait is too short to need a stand-in.
  return (
    <Suspense fallback={null}>
      <RoleHome />
    </Suspense>
  );
}

async function RoleHome() {
  const role = await getCurrentRole();
  return role === "agent" ? <AgentHome /> : <FarmerHome />;
}
