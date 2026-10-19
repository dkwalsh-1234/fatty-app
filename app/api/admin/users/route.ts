import { json, routeAdmin } from "@/lib/api";
import { admin } from "@/lib/supabase/admin";

export interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  status: "invited" | "joined" | "revoked";
  invited_at: string | null;
  last_sign_in_at: string | null;
  is_you: boolean;
}

// Admin only: who has been invited, who has joined, and who has been revoked.
export async function GET() {
  const auth = await routeAdmin();
  if ("error" in auth) return auth.error;
  const svc = admin();
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (error) return json({ error: error.message }, 502);
  const ids = data.users.map((u) => u.id);
  const { data: profiles } = await svc.from("profiles").select("user_id, display_name, onboarded_at").in("user_id", ids);
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const now = Date.now();
  const users: AdminUser[] = data.users
    .map((u) => {
      const banned = !!u.banned_until && new Date(u.banned_until).getTime() > now;
      const joined = !!u.last_sign_in_at || !!byId.get(u.id)?.onboarded_at;
      return {
        id: u.id,
        email: u.email ?? "",
        display_name: (byId.get(u.id)?.display_name as string | null) ?? null,
        status: banned ? "revoked" : joined ? "joined" : "invited",
        invited_at: u.invited_at ?? u.created_at ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        is_you: u.id === auth.user.id,
      } satisfies AdminUser;
    })
    .sort((a, b) => a.email.localeCompare(b.email));
  return json({ users });
}
