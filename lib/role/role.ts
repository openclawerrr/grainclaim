/**
 * The two roles of the demo. There are no logins: the Farmer / Agent switcher
 * in the top bar sets a cookie, and that cookie decides which screens show and
 * which role is saved in a record's "who" column (`uploaded_by`, `created_by`,
 * `resolved_by`). It is a view switch, not a security check.
 *
 * Pure functions only, so they can be tested and used anywhere. Server code
 * reads the current role with `getCurrentRole()` in `current-role.ts`.
 */

export const ROLES = ["farmer", "agent"] as const;

/** Also the exact text saved in a record's "who" column. */
export type Role = (typeof ROLES)[number];

/** The demo opens on Dave, so a browser with no role yet is the farmer. */
export const DEFAULT_ROLE: Role = "farmer";

export const ROLE_COOKIE = "grainclaim_role";

export const ROLE_LABELS: Record<Role, string> = {
  farmer: "Farmer",
  agent: "Agent",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The role in a cookie value. Anything missing or unrecognised is the farmer. */
export function parseRole(value: unknown): Role {
  return isRole(value) ? value : DEFAULT_ROLE;
}
