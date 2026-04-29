import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findPartyByInn } from "@/lib/dadata/party";
import { DadataError } from "@/lib/dadata/client";

/**
 * POST /api/dadata/party
 * Body: { inn: string }
 *
 * Looks up a Russian legal entity by INN via DaData (suggestions API).
 * Gated on the caller having an authenticated session AND the
 * `settings.use_dadata` permission.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data: canUseDadata } = await supabase.rpc("has_permission", {
    permission_code: "settings.use_dadata",
  });
  if (!canUseDadata) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
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
