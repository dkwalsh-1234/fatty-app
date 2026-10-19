import "server-only";
import { redirect } from "next/navigation";
import { toProfile } from "./profile";
import { adminEmail } from "./server-env";
import { admin } from "./supabase/admin";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

/** The signed-in person and their profile, or a redirect to /login. */
export async function requireSession(): Promise<{ userId: string; email: string; isAdmin: boolean; profile: Profile }> {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) redirect("/login");
  const { data: row } = await sb.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (!row) redirect("/login?error=profile");
  const email = (user.email ?? "").toLowerCase();
  const isAdmin = !!email && email === adminEmail();
  // ADMIN_EMAIL is the source of truth; the column mirrors it for the database.
  if (isAdmin !== row.is_admin) {
    await admin().from("profiles").update({ is_admin: isAdmin }).eq("user_id", user.id);
  }
  return { userId: user.id, email, isAdmin, profile: toProfile({ ...row, is_admin: isAdmin }) };
}
