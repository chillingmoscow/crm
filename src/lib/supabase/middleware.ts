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
    error: userError,
  } = await supabase.auth.getUser();

  // Транзиентный сбой auth-бэкенда (GoTrue 5xx / сетевая ошибка /
  // retryable fetch) → user=null, НО пользователь не разлогинен.
  // На таких НЕ редиректим на /login: оставляем текущие cookie и
  // пропускаем запрос — данные всё равно под RLS, а на следующем
  // запросе сессия восстановится. Иначе кратковременный сбой auth
  // (напр. рестарт GoTrue) выбрасывал бы всех на /login.
  // Прецедент: инцидент 2026-07-12 — refresh_token стабильно 500-ил
  // из-за рассинхрона версии GoTrue со схемой, и middleware
  // разлогинивал по каждому протухшему access-токену.
  const isTransientAuthFailure =
    !user &&
    !!userError &&
    (userError.name === "AuthRetryableFetchError" ||
      typeof userError.status !== "number" ||
      userError.status >= 500);

  // Редиректим на /login ТОЛЬКО когда пользователь ДОСТОВЕРНО не
  // аутентифицирован (нет user и это не транзиентный сбой). При
  // навигации Next prefetch'ит несколько разделов сразу, и
  // параллельные запросы устраивают гонку ротации refresh-токена
  // Supabase SSR — их мы тоже не роняем на /login по transient-ошибке.
  if (!user && !isPublicPath && !isTransientAuthFailure) {
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
