import { requireSession } from "@/lib/session";
import { PasswordForm } from "./PasswordForm";

export const metadata = { title: "Welcome" };

// After accepting an invite: set a password (the Android app signs in with it), then onboarding.
export default async function WelcomePage() {
  const s = await requireSession();
  return <PasswordForm email={s.email} next={s.profile.onboarded_at ? "/" : "/onboarding"} />;
}
