import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { pathname } = request.nextUrl;

  // Define public paths before any auth check to avoid redirect loops
  const publicPaths = [
    "/login",
    "/register",
    "/email-confirmed",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
    "/auth/confirm",
    "/set-password",
    "/invite",
  ];
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // Invalid/expired refresh token — clear stale cookies.
  // If already on a public path, don't redirect (would cause infinite loop).
  if (userError) {
    if (isPublicPath) return supabaseResponse;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
