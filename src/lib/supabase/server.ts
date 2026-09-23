import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database";
import { internalGlobalOptions } from "./internal-url";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Сетевой путь — по внутренней сети, адрес клиента остаётся публичным
      // (иначе поедут подписанные ссылки на файлы). См. internal-url.ts.
      global: internalGlobalOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component — можно игнорировать
          }
        },
      },
    }
  );
}

/**
 * Per-request cached auth user — Supabase Auth API вызывается ровно один раз
 * на весь RSC-дерево (layout + все дочерние страницы).
 * Возвращает null если не авторизован или при ошибке.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Per-request cached active account ID — RPC вызывается ровно один раз
 * на весь RSC-дерево. Layout + дочерние страницы получают одно и то же значение
 * без повторного DB-хита.
 */
export const getCachedActiveAccountId = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_active_account_id");
  return data as string | null;
});

/**
 * Per-request cached permission list — list_my_permissions RPC вызывается
 * ровно один раз на весь RSC-дерево.
 */
export const getCachedPermissions = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_my_permissions", {});
  return (data as string[] | null) ?? [];
});

/**
 * Проверка одного права — единственный способ, которым это стоит делать.
 *
 * Прямой `rpc("has_permission")` — это отдельный HTTP-запрос к PostgREST и
 * отдельное соединение пула на каждое право. Замер на проде: один вызов
 * `has_permission` стоит 0,69 мс работы базы, а `list_my_permissions`, который
 * отдаёт **весь** набор прав, — 0,78 мс. То есть узнать всё разом стоит
 * столько же, сколько спросить про одно, и `cache()` делает это один раз на
 * весь запрос, сколько бы прав ни проверяли layout и страницы вместе.
 *
 * Семантика прежняя: `list_my_permissions` и `has_permission` резолвятся по
 * одному и тому же активному заведению. Проверка здесь — гейт для UI и ранних
 * редиректов; доступ к данным по-прежнему принуждает RLS.
 */
export const getCachedPermissionChecker = cache(async () => {
  const codes = new Set(await getCachedPermissions());
  return (code: string) => codes.has(code);
});
