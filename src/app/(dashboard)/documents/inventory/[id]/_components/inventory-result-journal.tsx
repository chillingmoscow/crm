/* eslint-disable @next/next/no-img-element */
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { History } from "lucide-react";
import { formatAmount } from "@/lib/format/amount";

export type InventoryResultJournalEvent = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
  created_by: string | null;
  payload?: unknown;
  actor?: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
};

function eventTypeLabel(eventType: string) {
  const labels: Record<string, string> = {
    comment_updated: "Комментарий",
    exclude_enabled: "Не учитывать",
    exclude_disabled: "Вернули в итог",
    persistent_exclusion_enabled: "Автоисключение",
    persistent_exclusion_disabled: "Удаление автоисключения",
    resort_created: "Пересорт",
    resort_voided: "Отмена пересорта",
    results_finalized: "Итоги подведены",
    results_reopened: "Редактирование",
    results_refreshed: "Обновление",
    suggestion_applied: "Подсказка принята",
    suggestion_dismissed: "Подсказка скрыта",
    // recount mechanic (PR3):
    recount_marked: "Отметка пересчёта",
    recount_unmarked: "Снятие пересчёта",
    returned_for_recount: "Возврат на пересчёт",
  };
  return labels[eventType] ?? eventType;
}

function payloadReason(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).reason;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadResortText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const items = (payload as Record<string, unknown>).items;
  if (!Array.isArray(items)) return null;

  const rows = items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const productName = typeof row.productName === "string" ? row.productName : null;
      const role = row.role === "surplus" || row.role === "shortage" ? row.role : null;
      const amount = typeof row.sourceDifferenceAmount === "number" ? row.sourceDifferenceAmount : null;
      if (!productName || !role || amount === null) return null;
      return { productName, role, amount };
    })
    .filter((item): item is { productName: string; role: "surplus" | "shortage"; amount: number } => Boolean(item));

  const surplus = rows
    .filter((row) => row.role === "surplus")
    .map((row) => `${row.productName} (+${formatAmount(row.amount, 2)})`);
  const shortfall = rows
    .filter((row) => row.role === "shortage")
    .map((row) => `${row.productName} (${formatAmount(row.amount, 2)})`);

  if (surplus.length === 0 || shortfall.length === 0) return null;
  return `${surplus.join(", ")} -> ${shortfall.join(", ")}`;
}

function payloadComment(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).comment;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function actorName(actor: InventoryResultJournalEvent["actor"], fallback: string | null) {
  const name = [actor?.first_name, actor?.last_name].filter(Boolean).join(" ").trim();
  return name || fallback || "Система";
}

function actorInitials(actor: InventoryResultJournalEvent["actor"], fallback: string | null) {
  const source = actorName(actor, fallback);
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "S";
}

/**
 * Журнал событий по акту инвентаризации. Раньше жил во внутренней
 * вкладке results-table.tsx («Журнал решений»), что дублировало
 * layout-табу «Журнал». Вынесен в отдельный компонент и переехал в
 * /documents/inventory/[id]/history (layout-табa «Журнал»).
 */
export function InventoryResultJournal({
  events,
}: {
  events: InventoryResultJournalEvent[];
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Журнал событий пока пуст"
        description="Здесь появятся события по акту: комментарии, исключения, пересорт, пересчёт, проведение."
      />
    );
  }

  return (
    <div className="grid gap-2">
      {events.map((event) => {
        const reason = payloadReason(event.payload);
        const resortText = event.event_type === "resort_created" ? payloadResortText(event.payload) : null;
        const comment = event.event_type === "comment_updated" ? payloadComment(event.payload) : null;
        return (
          <div key={event.id} className="flex gap-3 rounded-lg border bg-card p-3 text-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium">
              {event.actor?.avatar_url ? (
                <img src={event.actor.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                actorInitials(event.actor, event.created_by)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{actorName(event.actor, event.created_by)}</span>
                <Badge variant="outline">{eventTypeLabel(event.event_type)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString("ru-RU")}
                </span>
              </div>
              <div className="mt-1 text-sm">{event.message}</div>
              {resortText ? (
                <div className="mt-1 text-xs text-muted-foreground">Зачет: {resortText}</div>
              ) : null}
              {comment ? <div className="mt-1 text-xs text-muted-foreground">Комментарий: {comment}</div> : null}
              {reason ? <div className="mt-1 text-xs text-muted-foreground">Причина: {reason}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
