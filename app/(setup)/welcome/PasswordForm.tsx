"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, Notice, Screen, ScreenTitle } from "@/components/ui";
import { supabase } from "@/lib/supabase/browser";

export function PasswordForm({ email, next }: { email: string; next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Those two don't match.");
    setSaving(true);
    const { error } = await supabase().auth.updateUser({ password });
    setSaving(false);
    if (error) return setError(/reauthenticat|recent/i.test(error.message) ? "For safety, sign out, sign back in with an email link, then set it straight away." : error.message);
    router.replace(next);
  }

  return (
    <Screen dock={false} className="pt-[8dvh]">
      <ScreenTitle sub={`Signed in as ${email}. Set a password so you can sign in on your phone.`}>Welcome to Fatty</ScreenTitle>
      <form onSubmit={save} className="flex flex-col gap-4">
        <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
        <Card className="flex flex-col gap-4">
          <Field label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Field label="Password again" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Card>
        <Notice tone="warn">{error}</Notice>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Set password"}
        </Button>
      </form>
    </Screen>
  );
}
