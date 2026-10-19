"use client";

import { useEffect, useState } from "react";
import { Notice, Screen, Spinner } from "@/components/ui";
import { safeNext } from "@/lib/safe-next";
import { supabase } from "@/lib/supabase/browser";

// Supabase's default invite email sends people here with the session in the URL fragment,
// which only the browser can read. Also handles ?code= and ?token_hash= links.
export default function AcceptPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const type = hash.get("type") ?? url.searchParams.get("type");
    const next = safeNext(url.searchParams.get("next"), type === "invite" || type === "recovery" ? "/welcome" : "/");
    const sb = supabase();
    (async () => {
      const hashError = hash.get("error_description");
      if (hashError) throw new Error(hashError.replace(/\+/g, " "));
      const access = hash.get("access_token");
      const refresh = hash.get("refresh_token");
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      if (access && refresh) {
        const { error } = await sb.auth.setSession({ access_token: access, refresh_token: refresh });
        if (error) throw error;
      } else if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else if (tokenHash) {
        const { error } = await sb.auth.verifyOtp({ type: (type ?? "invite") as "invite", token_hash: tokenHash });
        if (error) throw error;
      } else {
        const { data } = await sb.auth.getSession();
        if (!data.session) throw new Error("This link is missing its sign-in details.");
      }
      window.location.replace(next);
    })().catch((e: Error) => setError(`${e.message}. The link may have expired: ask for a new invite, or sign in.`));
  }, []);

  return (
    <Screen dock={false} className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-center">
      {error ? (
        <>
          <Notice tone="warn">{error}</Notice>
          <a href="/login" className="font-semibold text-accent">
            Go to sign in
          </a>
        </>
      ) : (
        <>
          <Spinner label="Signing you in" />
          <p className="text-ink2">Signing you in…</p>
        </>
      )}
    </Screen>
  );
}
