import { notFound, redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getCachedActiveAccountId, getCachedUser } from "@/lib/supabase/server";
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
export default async function InventoryDocumentHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [user, accountId, { data: canViewResults }] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    supabase.rpc("has_permission", { permission_code: "inventory.view_results" }),
  ]);
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
  const { data: eventsRaw } = await admin
    .from<EventRow[]>("inventory_result_events")
    .select("id, event_type, message, created_at, created_by, document_item_id, payload")
    .eq("account_id", accountId)
    .eq("document_id", document.id)
    .order("created_at", { ascending: false });

  const events = eventsRaw ?? [];
  const actorIds = Array.from(
    new Set(events.map((e) => e.created_by).filter((x): x is string => Boolean(x))),
  );
  const { data: actorsRaw } = actorIds.length > 0
    ? await admin
        .from<ActorRow[]>("profiles")
        .select("id, first_name, last_name, avatar_url")
        .in("id", actorIds)
    : { data: [] };
  const actorById = new Map((actorsRaw ?? []).map((a) => [a.id, a]));

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
  const { data: itemsRaw } = itemIds.length > 0
    ? await admin
        .from<Array<{ id: string; product_name: string }>>("document_items")
        .select("id, product_name")
        .eq("account_id", accountId)
        .in("id", itemIds)
    : { data: [] };
  const itemNameById: Record<string, string> = {};
  for (const item of itemsRaw ?? []) itemNameById[item.id] = item.product_name;
  const eventsWithActors: InventoryResultJournalEvent[] = events.map((event) => ({
    ...event,
    actor: event.created_by ? actorById.get(event.created_by) ?? null : null,
  }));

  return (
    <div className="w-full p-6 md:p-8">
      <InventoryResultJournal events={eventsWithActors} itemNames={itemNameById} />
    </div>
  );
}
