"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type RailItem = { href: string; label: string; icon: LucideIcon };

/**
 * One icon per screen that exists. Each new screen (farm map, tickets, the
 * report) adds its own item here in the pull request that builds it.
 */
const RAIL_ITEMS: readonly RailItem[] = [{ href: "/", label: "Home", icon: House }];

export function IconRail() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-line bg-card py-4">
      {RAIL_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "flex size-11 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "bg-green-700 text-white" : "text-ink-muted hover:bg-green-100 hover:text-ink",
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
