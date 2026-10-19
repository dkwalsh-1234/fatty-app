import { redirect } from "next/navigation";
import { AppProvider } from "@/components/app/AppProvider";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  if (!s.profile.onboarded_at) redirect("/onboarding");
  return <AppProvider initial={{ email: s.email, isAdmin: s.isAdmin, profile: s.profile }}>{children}</AppProvider>;
}
