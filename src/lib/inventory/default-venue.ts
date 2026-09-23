import type { LooseDb } from "@/lib/supabase/loose";

/**
 * Какому заведению принадлежат склады, приехавшие из Quick Resto.
 *
 * У этого правила есть второй, более старый носитель — SQL-функция
 * `resolve_default_store_venue` из миграции 215, которой пользуется
 * BEFORE INSERT-триггер на `stores`. Правило там сформулировано так:
 * QR-смапленное заведение берём, только если оно ОДНО живое на аккаунт;
 * иначе (ноль или несколько) не гадаем и отдаём NULL. Fallback — единственное
 * живое заведение аккаунта.
 *
 * Эта функция от него молча отличалась: брала `links[0]` из неупорядоченного
 * запроса и считала архивные заведения наравне с живыми. То есть на одну и ту
 * же ситуацию БД говорила «не знаю», а приложение — «вот это, наверное».
 * Теперь формулировка одна; расходиться им больше нечем.
 *
 * Шаг «активное заведение пользователя» есть только здесь: у триггера нет
 * пользователя. Он стоит между двумя шагами SQL-версии как страховка от
 * регресса — раньше он был единственным, что знал онбординг.
 *
 * Ничего однозначного не нашли — возвращаем null. Склад попадёт в
 * «Не распределённые», где его видно и можно привязать руками. Это честнее
 * догадки: привязка склада тащит за собой видимость актов, то есть уводит
 * документы к чужой смене.
 */
export async function resolveDefaultVenueId(input: {
  admin: LooseDb;
  accountId: string;
  activeVenueId: string | null;
}) {
  // 1. QR-смапленное заведение — и только если оно одно живое (см. 215).
  //
  // Ссылок может быть НЕСКОЛЬКО: unique-констрейнт миграции 029 стоит на
  // (account_id, provider, entity_type, external_id), то есть по строке на
  // каждое импортированное заведение, а онбординг разрешает выбрать их
  // сколько угодно. Брать «первую» нельзя — порядок в запросе не задан, и на
  // повторном прогоне склад уехал бы в другую точку, чем на первом.
  //
  // FK external_entity_links.local_id → venues.id нет (Codex P1 #378), поэтому
  // ссылка может указывать на удалённое или архивное заведение — такие
  // отсеиваем ДО подсчёта, иначе живое проиграло бы мёртвому соседу.
  // Multi-cloud (issue #362) пока не реализован.
  const { data: qrVenueLinks } = await input.admin
    .from<Array<{ local_id: string | null }>>("external_entity_links")
    .select("local_id")
    .eq("account_id", input.accountId)
    .eq("provider", "quickresto")
    .eq("entity_type", "venue");

  const linkedVenueIds = (qrVenueLinks ?? [])
    .map((link) => link.local_id)
    .filter((id): id is string => Boolean(id));

  if (linkedVenueIds.length > 0) {
    const { data: liveLinkedVenues } = await input.admin
      .from<Array<{ id: string }>>("venues")
      .select("id")
      .eq("account_id", input.accountId)
      .in("id", linkedVenueIds)
      .is("archived_at", null);
    if (liveLinkedVenues?.length === 1) return liveLinkedVenues[0].id;
  }

  // 2. Fallback: активное venue пользователя (legacy-поведение).
  if (input.activeVenueId) {
    const { data: activeVenue } = await input.admin
      .from<{ id: string }>("venues")
      .select("id")
      .eq("id", input.activeVenueId)
      .eq("account_id", input.accountId)
      .is("archived_at", null)
      .maybeSingle();
    if (activeVenue?.id) return activeVenue.id;
  }

  // 3. Последний fallback: единственное живое venue в аккаунте.
  // Архивные не считаем — иначе аккаунт с одним рабочим и одним архивным
  // заведением получал null там, где выбор на самом деле однозначен.
  const { data: venues } = await input.admin
    .from<Array<{ id: string }>>("venues")
    .select("id")
    .eq("account_id", input.accountId)
    .is("archived_at", null);
  return venues?.length === 1 ? venues[0].id : null;
}
