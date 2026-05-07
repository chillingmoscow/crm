import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
