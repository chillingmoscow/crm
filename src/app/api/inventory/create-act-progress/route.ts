import { NextResponse } from "next/server";

import { createActProgressStore } from "@/lib/inventory/act-create-progress";
import { getCachedUser } from "@/lib/supabase/server";

/**
 * GET /api/inventory/create-act-progress?attempt=<uuid>
 *
 * Ход создания акта для панели «Создать акт»: фаза и сколько позиций уже в
 * Quick Resto. Не server action — действия одного клиента Next выполняет по
 * очереди, и опрос ждал бы конца создания. Ход отдаём только тому, кто
 * создаёт акт; нет хода — `{ progress: null }`, панель покажет расчётное время.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCachedUser();
  if (!user) return NextResponse.json({ progress: null }, { status: 401 });
  const attempt = new URL(request.url).searchParams.get("attempt") ?? "";
  const progress = attempt ? createActProgressStore().get(attempt, user.id) : null;
  return NextResponse.json({ progress }, { headers: { "Cache-Control": "no-store" } });
}
