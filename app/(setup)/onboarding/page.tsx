import { requireSession } from "@/lib/session";
import { Onboarding } from "./Onboarding";

export const metadata = { title: "Set up" };

export default async function OnboardingPage() {
  const s = await requireSession();
  return <Onboarding profile={s.profile} />;
}
