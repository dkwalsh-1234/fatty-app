import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// Email links (sign-in links, and invites if the email template uses token_hash) land here.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
  const next = safeNext(url.searchParams.get("next"), type === "invite" || type === "recovery" ? "/welcome" : "/");
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const sb = await createClient();
  const { error } = code
    ? await sb.auth.exchangeCodeForSession(code)
    : tokenHash
      ? await sb.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("missing token") };
  redirect(error ? `/login?error=link&next=${encodeURIComponent(next)}` : next);
}
