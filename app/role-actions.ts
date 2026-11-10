"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ROLE_COOKIE, isRole } from "@/lib/role/role";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/**
 * The Farmer / Agent switcher in the top bar. Saves the chosen role in a
 * cookie and goes to that role's home screen, so switching from a screen the
 * other role doesn't have never leaves a dead page.
 */
export async function setRole(formData: FormData): Promise<void> {
  const role = formData.get("role");
  if (isRole(role)) {
    const cookieStore = await cookies();
    cookieStore.set(ROLE_COOKIE, role, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: ONE_YEAR_IN_SECONDS,
    });
  }
  redirect("/");
}
