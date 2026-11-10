/**
 * The current role, for server code: server components, server actions and
 * `app/api/` routes.
 *
 * Use it to fill a record's "who" column when saving, for example
 * `uploaded_by: await getCurrentRole()`. Never take the role from a request
 * body or a form field; read it here.
 *
 * Reading a cookie happens at request time, so a component that awaits this
 * must sit inside a `<Suspense>` boundary (Cache Components is on).
 */
import "server-only";
import { cookies } from "next/headers";
import { ROLE_COOKIE, parseRole, type Role } from "./role";

export async function getCurrentRole(): Promise<Role> {
  const cookieStore = await cookies();
  return parseRole(cookieStore.get(ROLE_COOKIE)?.value);
}
