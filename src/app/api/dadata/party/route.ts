import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findPartyByInn } from "@/lib/dadata/party";
import { DadataError } from "@/lib/dadata/client";

/**
 * POST /api/dadata/party
 * Body: { inn: string }
 *
 * Looks up a Russian legal entity by INN via DaData (suggestions API).
 * Gated on authenticated session. `has_permission('settings.use_dadata')`
 * НЕ требуется по двум причинам:
 *   1. В onboarding-flow у user'а ещё нет аккаунта → нет UVR →
 *      has_permission всегда false, lookup не работает (а должен —
 *      это ключевой шаг сетапа юрлица).
 *   2. DaData запрашивается через server-side API key, никаких
 *      sensitive операций с user-data нет; risk минимальный.
 * Rate-limit на DaData side есть, дополнительно лимитировать на
 * нашем уровне — отдельная задача в бэклоге.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const inn =
    typeof body === "object" && body !== null && "inn" in body
      ? String((body as { inn: unknown }).inn ?? "").trim()
      : "";

  if (!inn) {
    return NextResponse.json({ error: "Укажите ИНН" }, { status: 400 });
  }

  try {
    const party = await findPartyByInn(inn);
    if (!party) {
      return NextResponse.json({ error: "По этому ИНН ничего не найдено" }, { status: 404 });
    }
    return NextResponse.json({ party });
  } catch (err) {
    const status = err instanceof DadataError && err.status ? 502 : 500;
    const message =
      err instanceof Error
        ? err.message
        : "Не удалось получить данные из DaData";
    return NextResponse.json({ error: message }, { status });
  }
}
