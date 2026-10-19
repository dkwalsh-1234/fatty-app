import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./lib/config";

// Refreshes the Supabase session on every page request and sends signed-out visitors to /login.
// API routes are excluded: they check the session themselves and answer 401 in JSON.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { pathname, search, searchParams } = request.nextUrl;

  // Supabase sends links back to the Site URL when the redirect isn't allow-listed.
  const code = searchParams.get("code");
  if (code && !pathname.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/accept";
    return NextResponse.redirect(url);
  }

  const { data } = await supabase.auth.getClaims();
  const isPublic =
    pathname === "/login" ||
    pathname === "/about" ||
    pathname.startsWith("/auth/") ||
    (process.env.NODE_ENV !== "production" && pathname.startsWith("/dev"));

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|zxing|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|woff2)$).*)",
  ],
};
