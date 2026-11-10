import { setRole } from "@/app/role-actions";
import { getCurrentRole } from "@/lib/role/current-role";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/role/role";
import { cn } from "@/lib/utils";

/**
 * The Farmer / Agent switcher. The demo has no logins: choosing a role saves
 * it in a cookie and opens that role's home screen.
 */
export async function RoleSwitcher() {
  const role = await getCurrentRole();
  return <RoleButtons current={role} />;
}

/** Shown for the moment before the role is known: same shape, nothing chosen. */
export function RoleSwitcherFallback() {
  return <RoleButtons current={null} />;
}

function RoleButtons({ current }: { current: Role | null }) {
  return (
    <form
      action={current ? setRole : undefined}
      role="group"
      aria-label="View as"
      className="flex items-center gap-1 rounded-full border border-line bg-page p-1"
    >
      {ROLES.map((role) => {
        const chosen = role === current;
        return (
          <button
            key={role}
            type="submit"
            name="role"
            value={role}
            aria-pressed={chosen}
            disabled={current === null}
            className={cn(
              "h-10 min-w-24 cursor-pointer rounded-full px-5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
              chosen ? "bg-green-700 text-white" : "text-ink-muted hover:bg-green-100 hover:text-ink",
            )}
          >
            {ROLE_LABELS[role]}
          </button>
        );
      })}
    </form>
  );
}
