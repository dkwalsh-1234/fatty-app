'use client';

// Admin (Daniel only): invite by email, list who has been invited or joined, revoke access.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { Button, Card, Field, Notice, Screen, ScreenTitle, Spinner, TopBar } from '@/components/ui';
import type { AdminUser } from '@/app/api/admin/users/route';

const STATUS: Record<AdminUser['status'], string> = { invited: 'Invited, not joined yet', joined: 'Joined', revoked: 'Access revoked' };

export default function AdminPage() {
  const app = useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch('/api/admin/users')
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "Couldn't load people.");
          setUsers(body.users);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    if (!app.isAdmin) router.replace('/');
    else void load();
  }, [app.isAdmin, router, load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy('invite');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't send the invite.");
      setNotice(`Invite sent to ${email}. They'll set a password and land in onboarding.`);
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invite.");
    } finally {
      setBusy(null);
    }
  }

  async function act(u: AdminUser, restore: boolean) {
    setBusy(u.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: restore ? 'POST' : 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'That didn\'t work.');
      setNotice(restore ? `${u.email} can sign in again.` : body.removed ? `Invite to ${u.email} withdrawn.` : `${u.email} can no longer sign in. Their data is kept.`);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen dock={false}>
      <TopBar back="/settings" />
      <ScreenTitle sub="Fatty is invite-only. Public sign-up is off.">Admin</ScreenTitle>
      <form onSubmit={invite} className="flex items-end gap-2">
        <Field label="Invite by email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
        <Button size="md" type="submit" disabled={busy === 'invite' || !email.includes('@')}>
          {busy === 'invite' ? 'Sending…' : 'Invite'}
        </Button>
      </form>
      <Notice className="mt-3">{notice}</Notice>
      <Notice tone="warn" className="mt-3">
        {error}
      </Notice>
      <h2 className="caps mx-1 mb-2 mt-5 text-ink2">People</h2>
      {!users ? (
        <div className="mt-6 flex justify-center">
          <Spinner />
        </div>
      ) : (
        <Card className="py-1">
          {users.map((u) => (
            <div key={u.id} className="flex min-h-[60px] items-center gap-3 border-t border-separator py-2 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">
                  {u.display_name ? `${u.display_name} · ` : ''}
                  {u.email}
                </span>
                <span className="block text-[13px] text-ink2">
                  {u.is_you ? 'You' : STATUS[u.status]}
                  {u.last_sign_in_at && ` · last seen ${new Date(u.last_sign_in_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`}
                </span>
              </span>
              {!u.is_you &&
                (u.status === 'revoked' ? (
                  <Button size="sm" variant="secondary" disabled={busy === u.id} onClick={() => act(u, true)}>
                    Restore
                  </Button>
                ) : confirming === u.id ? (
                  <Button size="sm" variant="warnLink" disabled={busy === u.id} onClick={() => act(u, false)}>
                    {u.status === 'invited' ? 'Withdraw invite?' : 'Revoke access?'}
                  </Button>
                ) : (
                  <Button size="sm" variant="warnLink" onClick={() => setConfirming(u.id)}>
                    Revoke
                  </Button>
                ))}
            </div>
          ))}
        </Card>
      )}
      <p className="mx-1 mt-3 text-[13px] leading-snug text-ink2">
        Revoking keeps someone&apos;s data and stops them signing in; Restore undoes it. Foods they added to the shared catalogue stay.
      </p>
    </Screen>
  );
}
