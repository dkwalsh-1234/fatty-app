import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = sp.error === "link" ? "That link has expired or was already used. Sign in below, or ask for a new link." : null;
  return <LoginForm next={next} initialError={error} />;
}
