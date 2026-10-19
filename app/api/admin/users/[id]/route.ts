import { bad, json, routeAdmin } from "@/lib/api";
import { admin } from "@/lib/supabase/admin";

// Admin only: revoke someone's access. A pending invite is withdrawn (the account is removed);
// anyone who has joined is blocked from signing in, keeping their data in case access comes back.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const auth = await routeAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (id === auth.user.id) return bad("You can't revoke your own access.");
  const svc = admin();
  const { data, error } = await svc.auth.admin.getUserById(id);
  if (error || !data.user) return bad("Couldn't find that person.", 404);
  if (!data.user.last_sign_in_at) {
    const { error: e } = await svc.auth.admin.deleteUser(id);
    if (e) return bad(e.message, 502);
    return json({ ok: true, removed: true });
  }
  const { error: e } = await svc.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (e) return bad(e.message, 502);
  return json({ ok: true });
}

/** Restore access for someone who was revoked. */
export async function POST(_req: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const auth = await routeAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const { error } = await admin().auth.admin.updateUserById(id, { ban_duration: "none" });
  if (error) return bad(error.message, 502);
  return json({ ok: true });
}
