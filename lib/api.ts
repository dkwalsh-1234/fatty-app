import "server-only";
import { NextResponse } from "next/server";
import { adminEmail } from "./server-env";
import { createClient } from "./supabase/server";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export const bad = (error: string, status = 400) => json({ error }, status);

/** The signed-in person for an API route, with an RLS client acting as them. */
export async function routeUser() {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return { error: bad("Please sign in again.", 401) } as const;
  return { user: data.user, sb } as const;
}

export async function routeAdmin() {
  const r = await routeUser();
  if ("error" in r) return r;
  if ((r.user.email ?? "").toLowerCase() !== adminEmail() || !adminEmail()) return { error: bad("Only the admin can do that.", 403) } as const;
  return r;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
