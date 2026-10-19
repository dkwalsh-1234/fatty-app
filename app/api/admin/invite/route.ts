import { z } from "zod";
import { bad, json, readJson, routeAdmin } from "@/lib/api";
import { SITE_URL } from "@/lib/config";
import { admin } from "@/lib/supabase/admin";

// Admin only: send a Supabase invite with the service key. Public sign-up stays off; the friend
// follows the email, sets a password and lands in onboarding.
export async function POST(req: Request) {
  const auth = await routeAdmin();
  if ("error" in auth) return auth.error;
  const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(await readJson(req));
  if (!parsed.success) return bad("That doesn't look like an email address.");
  const origin = SITE_URL || new URL(req.url).origin;
  const { data, error } = await admin().auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/accept?next=/welcome`,
  });
  if (error) {
    if (/already been registered|already exists/i.test(error.message)) return bad("That person already has an account.");
    return bad(`Supabase couldn't send the invite: ${error.message}`, 502);
  }
  return json({ ok: true, id: data.user?.id });
}
