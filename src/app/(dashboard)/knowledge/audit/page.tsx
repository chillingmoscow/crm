import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listKbAuditEvents } from "@/lib/knowledge/audit";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { KbAuditEventRow } from "@/app/(dashboard)/knowledge/audit/_components/kb-audit-event-row";

/**
 * Журнал KB-audit-событий. Доступ — `org.view_audit` (та же permission,
 * что для общего audit_logs; миграция 035 §RLS).
 *
 * Pagination — keyset через композитный курсор `?before_at=...&before_id=...`
 * (см. KbAuditEventRow footer ссылку «Старее»). Композит нужен потому
 * что cascade-операции (delete-cascade) вставляют десятки rows с
 * одинаковым created_at — простой `lt(created_at)` пропускал бы
 * остальные events с тем же timestamp на page2. См. Codex #52 P1.
 */
export default async function KbAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ before_at?: string; before_id?: string }>;
}) {
  const { before_at: beforeCreatedAt, before_id: beforeId } =
    await searchParams;
  const supabase = await createClient();
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "org.view_audit",
  });
  if (!canView) redirect("/knowledge");

  const { events, hasMore, error } = await listKbAuditEvents({
    beforeCreatedAt,
    beforeId,
  });

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <span className="text-sm font-medium text-foreground inline-flex items-center gap-2">
          <ScrollText className="size-4 text-muted-foreground" />
          Журнал изменений
        </span>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-6 pb-8 w-full flex flex-col gap-6">
        <div className="mx-auto w-full max-w-[760px] flex flex-col gap-3">
          <h1 className="text-[28px] font-extrabold tracking-tight">
            Журнал изменений
          </h1>
          <p className="text-sm text-muted-foreground">
            История создания, переименования, перемещения и удаления
            страниц базы знаний. Изменения внутри страницы (правки контента)
            видны через «Историю версий» на самой странице.
          </p>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Не удалось загрузить журнал: {error}
            </div>
          )}

          {!error && events.length === 0 && !beforeCreatedAt && (
            <EmptyState
              icon={ScrollText}
              title="Пока пусто"
              description="Сюда будут попадать события: создание, переименование, перемещение и удаление KB-страниц."
            />
          )}

          {!error && events.length > 0 && (
            <ul className="flex flex-col rounded-md border bg-background overflow-hidden">
              {events.map((event) => (
                <KbAuditEventRow key={event.id} event={event} />
              ))}
            </ul>
          )}

          {hasMore && events.length > 0 && (
            <div className="flex justify-center pt-2">
              <a
                href={`/knowledge/audit?before_at=${encodeURIComponent(events[events.length - 1].created_at)}&before_id=${encodeURIComponent(events[events.length - 1].id)}`}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Показать события старее →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
