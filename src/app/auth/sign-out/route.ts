import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * GET/POST /auth/sign-out
 *
 * Чистит сессию Supabase Auth (cookies) и редиректит на `?next=` (по
 * умолчанию `/login`).
 *
 * Использование: ссылка из confirm-email-change → юзер должен зайти
 * заново под новым email. Также может быть использован любым "logout"
 * UI-элементом в будущем.
 */
async function handle(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const next = searchParams.get("next") || "/login";

  const supabase = await createClient();
  // signOut здесь работает через cookies-адаптер createClient: убирает
  // sb-* куки из response. Если юзер уже не залогинен — silent no-op.
  await supabase.auth.signOut();

  const url = new URL(next, request.url);
  return NextResponse.redirect(url);
}

export const GET = handle;
export const POST = handle;
