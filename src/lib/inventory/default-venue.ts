import type { LooseDb } from "@/lib/supabase/loose";

/**
 * Какому заведению принадлежат склады, приехавшие из Quick Resto.
 *
 * Порядок неочевиден и важен: сначала venue, которое сам же импорт и завёл
 * (ссылка в external_entity_links) — это основной случай; активное venue
 * пользователя и «единственное в аккаунте» идут дальше как страховка.
 *
 * Онбординг держал свою версию без первого шага: там импорт привязывал склады
 * к активному venue пользователя, хотя QR-venue уже создан этим же прогоном.
 * На аккаунте с одним заведением разницы не было, на нескольких — склады
 * уезжали не туда.
 */

export async function resolveDefaultVenueId(input: {
  admin: LooseDb;
  accountId: string;
  activeVenueId: string | null;
}) {
  // 1. QR-импортированное venue (priority — основной кейс).
  // В норме строка одна на (account, provider='quickresto', entity_type='venue').
  // Codex P1 #378: нет FK external_entity_links.local_id → venues.id,
  // поэтому возможен orphan (venue hard-удалён, link остался) или
  // ссылка на архивный venue. Перед использованием проверяем что
  // venue физически существует и live — иначе fallback ниже.
  // Multi-cloud (issue #362) пока не реализован.
  const { data: qrVenueLinks } = await input.admin
    .from<Array<{ local_id: string }>>("external_entity_links")
    .select("local_id")
    .eq("account_id", input.accountId)
    .eq("provider", "quickresto")
    .eq("entity_type", "venue");
  const qrVenueId = qrVenueLinks?.[0]?.local_id;
  if (qrVenueId) {
    const { data: qrVenue } = await input.admin
      .from<{ id: string; archived_at: string | null }>("venues")
      .select("id, archived_at")
      .eq("id", qrVenueId)
      .eq("account_id", input.accountId)
      .maybeSingle();
    if (qrVenue?.id && !qrVenue.archived_at) return qrVenue.id;
    // orphan / archived — пропускаем, идём на fallback
  }

  // 2. Fallback: активный venue (legacy-поведение, защита от регресса)
  if (input.activeVenueId) {
    const { data: activeVenue } = await input.admin
      .from<{ id: string }>("venues")
      .select("id")
      .eq("id", input.activeVenueId)
      .eq("account_id", input.accountId)
      .maybeSingle();
    if (activeVenue?.id) return activeVenue.id;
  }

  // 3. Final fallback: единственное venue в аккаунте
  const { data: venues } = await input.admin
    .from<Array<{ id: string }>>("venues")
    .select("id")
    .eq("account_id", input.accountId);
  return venues?.length === 1 ? venues[0].id : null;
}
