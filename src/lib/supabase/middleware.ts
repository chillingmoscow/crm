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
    "/auth/revoke-email-change",
    "/invite/accept",
    "/set-password",
  ];
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Редиректим на /login ТОЛЬКО когда пользователя реально нет.
  // Раньше редиректили по любому `userError` — но при навигации
  // Next prefetch'ит несколько разделов сразу, и параллельные
  // запросы устраивают гонку ротации refresh-токена Supabase SSR:
  // один обновляет токен, остальные приходят с уже использованным →
  // transient `userError`, хотя пользователь залогинен. Это
  // выбрасывало на /login на ровном месте. Если refresh-token
  // действительно протух — getUser вернёт user=null и сработает
  // ветка ниже; защита остаётся на RLS + серверных guard'ах.
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
