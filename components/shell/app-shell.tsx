import type { ReactNode } from "react";
import { IconRail } from "./icon-rail";
import { TopBar } from "./top-bar";

/**
 * The frame around every screen: one top bar and a thin icon rail, nothing
 * else around the edges (docs/design.md). Laid out for a laptop browser; the
 * phone layout comes after the hackathon.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh min-w-[64rem] flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <IconRail />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
