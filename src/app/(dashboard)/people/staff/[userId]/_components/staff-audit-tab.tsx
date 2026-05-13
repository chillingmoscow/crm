"use client";

import { useState, useTransition } from "react";
import { ScrollText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { AuditEventRow } from "@/components/audit/audit-event-row";
import { listAuditEvents, type AuditEvent } from "@/lib/audit/list";

interface Props {
  userId: string;
  initialEvents: AuditEvent[];
  initialHasMore: boolean;
}

export function StaffAuditTab({ userId, initialEvents, initialHasMore }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onLoadMore = () => {
    const last = events[events.length - 1];
    if (!last) return;
    startTransition(async () => {
      const result = await listAuditEvents({
        entityType: "staff",
        entityId: userId,
        beforeCreatedAt: last.created_at,
        beforeId: last.id,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEvents((prev) => [...prev, ...result.events]);
      setHasMore(result.hasMore);
    });
  };

  if (events.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <EmptyState
          icon={ScrollText}
          title="Журнал пуст"
          description="Здесь появятся события: приём на работу, смена должности, увольнение, восстановление, обновление контактов и HR-данных."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[760px] flex flex-col gap-3">
      <ul className="flex flex-col rounded-md border bg-background overflow-hidden">
        {events.map((event) => (
          <AuditEventRow key={event.id} event={event} hideEntity />
        ))}
      </ul>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Не удалось загрузить: {error}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isPending}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {isPending ? "Загружаем…" : "Показать события старее →"}
          </button>
        </div>
      )}
    </div>
  );
}
