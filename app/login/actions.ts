"use server";

import { headers } from "next/headers";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { ok?: boolean; next?: string; error?: string; sent?: boolean };

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!email || !password) return { error: "Type your email and password." };
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status === 429) return { error: "Too many tries. Wait a minute, then try again." };
    if (/ban/i.test(error.message)) return { error: "Your access has been turned off. Ask Daniel if that's a mistake." };
    return { error: "That email and password don't match." };
  }
  return { ok: true, next };
}

/** A sign-in link for people who already have an account. Never creates one: sign-up is invite-only. */
export async function sendLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(form.get("next"));
  if (!email) return { error: "Type your email first." };
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const sb = await createClient();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  // Don't reveal whether an account exists.
  if (error && error.status === 429) return { error: "Too many emails. Wait a minute, then try again." };
  return { sent: true };
}
