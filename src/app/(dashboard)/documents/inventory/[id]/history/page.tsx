import { notFound, redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCachedActiveAccountId,
  getCachedPermissions,
  getCachedUser,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";

import { getCachedInventoryDocumentBasics } from "../layout";
import {
  InventoryResultJournal,
  type InventoryResultJournalEvent,
} from "../_components/inventory-result-journal";

type EventRow = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
  created_by: string | null;
  document_item_id: string | null;
  payload?: unknown;
};

type ActorRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

/**
 * Таб «Журнал» страницы акта. Показывает события из
 * inventory_result_events (комментарии, исключения, пересорт,
 * пересчёт, проведение). Раньше дублировалось внутренней вкладкой
 * «Журнал решений» в results-table — теперь единое место.
 */
/**
 * Сколько событий показываем по умолчанию. Журнал — лента, её читают сверху,
 * и целиком она нужна редко; при этом каждое событие тянет ещё и payload
 * (jsonb). Раньше лимита не было вовсе: на акте с сотнями решений страница
 * везла весь журнал на каждый заход.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 2000;

export default async function InventoryDocumentHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ limit?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(DEFAULT_LIMIT, Number.parseInt(sp.limit ?? "", 10) || DEFAULT_LIMIT),
  );

  const [user, accountId, permissions] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissions(),
  ]);
  const canViewResults = permissions.includes("inventory.view_results");
  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");
  // Журнал решений = часть итогов. Без права на итоги доступа нет (зеркало
  // гейта таба в document-act-header.tsx). Layout уже проверил доступ к
  // акту (canSeeAct + venue), здесь — конкретно право на журнал/итоги.
  if (!canViewResults) redirect(`/documents/inventory/${id}`);

  const document = await getCachedInventoryDocumentBasics(id, accountId as string);
  if (!document) notFound();

  // RLS-проверку доступа к акту делает layout (canSeeAct). Здесь читаем
  // события через admin (как и остальной inventory-flow).
  const admin = asLooseDb(createAdminClient());
  // Просим на одну запись больше лимита: так узнаём, есть ли ещё, не платя за
  // отдельный count.
  const { data: eventsRaw } = await admin
    .from<EventRow[]>("inventory_result_events")
    .select("id, event_type, message, created_at, created_by, document_item_id, payload")
    .eq("account_id", accountId)
    .eq("document_id", document.id)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  const page = eventsRaw ?? [];
  const hasMore = page.length > limit;
  const events = hasMore ? page.slice(0, limit) : page;
  const actorIds = Array.from(
    new Set(events.map((e) => e.created_by).filter((x): x is string => Boolean(x))),
  );
  const actorsPromise = actorIds.length > 0
    ? admin
        .from<ActorRow[]>("profiles")
        .select("id, first_name, last_name, avatar_url")
        .in("id", actorIds)
    : Promise.resolve({ data: [] as ActorRow[] });

  // Названия позиций для событий пересчёта: в журнале «Отметил строку на
  // пересчёт» без названия бесполезно. Собираем id из самого события и из
  // payload (одна строка — itemId, пачка — flaggedItemIds/itemIds).
  const payloadIds = (payload: unknown): string[] => {
    if (!payload || typeof payload !== "object") return [];
    const row = payload as Record<string, unknown>;
    const out: string[] = [];
    if (typeof row.itemId === "string") out.push(row.itemId);
    for (const key of ["flaggedItemIds", "itemIds"]) {
      const value = row[key];
      if (Array.isArray(value)) out.push(...value.filter((v): v is string => typeof v === "string"));
    }
    return out;
  };
  const itemIds = Array.from(
    new Set(events.flatMap((event) => [event.document_item_id, ...payloadIds(event.payload)])),
  ).filter((value): value is string => Boolean(value));
  // Профили авторов и названия позиций друг от друга не зависят — раньше шли
  // двумя await подряд.
  const [{ data: actorsRaw }, { data: itemsRaw }] = await Promise.all([
    actorsPromise,
    itemIds.length > 0
      ? admin
          .from<Array<{ id: string; product_name: string }>>("document_items")
          .select("id, product_name")
          .eq("account_id", accountId)
          .in("id", itemIds)
      : Promise.resolve({ data: [] as Array<{ id: string; product_name: string }> }),
  ]);
  const actorById = new Map((actorsRaw ?? []).map((a) => [a.id, a]));
  const itemNameById: Record<string, string> = {};
  for (const item of itemsRaw ?? []) itemNameById[item.id] = item.product_name;
  const eventsWithActors: InventoryResultJournalEvent[] = events.map((event) => ({
    ...event,
    actor: event.created_by ? actorById.get(event.created_by) ?? null : null,
  }));

  return (
    <div className="w-full p-6 md:p-8">
      <InventoryResultJournal
        events={eventsWithActors}
        itemNames={itemNameById}
        moreHref={hasMore ? `/documents/inventory/${id}/history?limit=${limit * 3}` : null}
      />
    </div>
  );
}
