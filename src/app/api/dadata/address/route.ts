import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestAddresses } from "@/lib/dadata/address";
import { DadataError } from "@/lib/dadata/client";

/**
 * POST /api/dadata/address
 * Body: { query: string, count?: number }
 *
 * Returns ranked address suggestions from DaData. Gated on the caller
 * having an authenticated session AND the `settings.use_dadata`
 * permission.
 *
 * Designed to be called from a debounced client input — empty / very
 * short queries return [] without billing a DaData hit.
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

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const query = String((body as { query?: unknown }).query ?? "").trim();
  const rawCount = (body as { count?: unknown }).count;
  const count = typeof rawCount === "number" && rawCount >= 1 && rawCount <= 20
    ? rawCount
    : 7;

  try {
    const suggestions = await suggestAddresses(query, count);
    return NextResponse.json({ suggestions });
  } catch (err) {
    const status = err instanceof DadataError && err.status ? 502 : 500;
    const message =
      err instanceof Error
        ? err.message
        : "Не удалось получить подсказки адресов";
    return NextResponse.json({ error: message }, { status });
  }
}
