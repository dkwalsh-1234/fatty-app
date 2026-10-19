"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button, Card, Field, Notice, Screen } from "@/components/ui";
import { sendLink, signIn, type LoginState } from "./actions";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [state, passwordAction, pending] = useActionState<LoginState, FormData>(signIn, {});
  const [linkState, linkAction, linkPending] = useActionState<LoginState, FormData>(sendLink, {});

  useEffect(() => {
    if (state.ok) router.replace(state.next ?? "/");
  }, [state, router]);

  return (
    <Screen dock={false} className="pt-[12dvh]">
      <div className="mb-6 px-1">
        <p className="caps text-ink2">Fatty</p>
        <h1 className="mt-1 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em]">Sign in</h1>
        <p className="mt-2 text-[15px] text-ink2">By invitation only. Use the email your invite came to.</p>
      </div>
      {linkState.sent ? (
        <Card>
          <p className="text-base">Check your email for a sign-in link.</p>
          <p className="mt-1 text-[14px] text-ink2">In the Android app, sign in with your password instead: links open in Chrome.</p>
        </Card>
      ) : (
        <form action={mode === "password" ? passwordAction : linkAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Card className="flex flex-col gap-4">
            <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
            {mode === "password" && <Field label="Password" name="password" type="password" autoComplete="current-password" required />}
          </Card>
          <Notice tone="warn">{(mode === "password" ? state.error : linkState.error) ?? initialError}</Notice>
          <Button type="submit" disabled={pending || linkPending}>
            {mode === "password" ? (pending ? "Signing in…" : "Sign in") : linkPending ? "Sending…" : "Email me a link"}
          </Button>
          <div className="flex justify-center">
            <Button variant="link" onClick={() => setMode(mode === "password" ? "link" : "password")}>
              {mode === "password" ? "Forgot your password? Email me a link" : "Use my password instead"}
            </Button>
          </div>
        </form>
      )}
    </Screen>
  );
}
