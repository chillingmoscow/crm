import { notFound, redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedActiveAccountId, getCachedUser } from "@/lib/supabase/server";
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

  const [user, accountId] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
  ]);
  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");

  const document = await getCachedInventoryDocumentBasics(id, accountId as string);
  if (!document) notFound();

  // RLS-проверку доступа к акту делает layout (canSeeAct). Здесь читаем
  // события через admin (как и остальной inventory-flow).
  const admin = asLooseDb(createAdminClient());
  const { data: eventsRaw } = await admin
    .from<EventRow[]>("inventory_result_events")
    .select("id, event_type, message, created_at, created_by, payload")
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
  const eventsWithActors: InventoryResultJournalEvent[] = events.map((event) => ({
    ...event,
    actor: event.created_by ? actorById.get(event.created_by) ?? null : null,
  }));

  return (
    <div className="w-full p-6 md:p-8">
      <InventoryResultJournal events={eventsWithActors} />
    </div>
  );
}
