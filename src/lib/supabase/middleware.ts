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

  // Транзиентный, retryable-сбой auth-бэкенда (сетевая ошибка или
  // 502/503/504) → user=null, НО пользователь не разлогинен. КЛЮЧЕВОЕ:
  // ровно для этого класса ошибок @supabase/auth-js НЕ удаляет сессию
  // (`_callRefreshToken`: `if (!isAuthRetryableFetchError) _removeSession()`),
  // поэтому `supabaseResponse` НЕ содержит cookie-удаляющих Set-Cookie,
  // и вернуть его = сохранить сессию. На таких НЕ редиректим на /login:
  // данные всё равно под RLS, сессия восстановится на следующем запросе.
  //
  // ВАЖНО (Codex P1): «голый» 500 сюда НЕ входит — auth-js мапит его в
  // AuthApiError (не retryable) и УЖЕ удаляет cookie внутри getUser().
  // По status>=500 гейтить было нельзя: вернули бы ответ с удалением
  // cookie и всё равно разлогинили. Retryable = только name ===
  // "AuthRetryableFetchError" (сеть/502/503/504). Наш прод-500 на
  // refresh_token лечится на уровне GoTrue (bump версии), не здесь.
  const isTransientAuthFailure =
    !user && userError?.name === "AuthRetryableFetchError";

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
