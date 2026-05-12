import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listDeletedKbPages } from "@/lib/knowledge/pages";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { TrashItemRow } from "@/app/(dashboard)/knowledge/trash/_components/trash-item-row";

/**
 * Корзина базы знаний. Доступ — только под `kb.delete_pages` (та же
 * permission, что и удаление; видимость soft-deleted строк гейтится
 * там же на уровне RLS — миграция 050 / 046).
 *
 * Восстановление — `restoreKbPage` через TrashItemRow (client).
 * Hard-delete и автопурж по 30-дневному таймеру вне MVP.
 */
export default async function KnowledgeTrashPage() {
  const supabase = await createClient();
  const { data: canDelete } = await supabase.rpc("has_permission", {
    permission_code: "kb.delete_pages",
  });
  if (!canDelete) redirect("/knowledge");

  // listDeletedKbPages возвращает только soft-deleted строки —
  // RLS пропустит их только пользователю с kb.delete_pages.
  const { rows } = await listDeletedKbPages();

  // Подтягиваем имена тех, кто удалил, для строк где deleted_by заполнен.
  const deletedByIds = Array.from(
    new Set(rows.map((r) => r.deleted_by).filter((id): id is string => !!id)),
  );
  const profilesById = new Map<string, string>();
  if (deletedByIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", deletedByIds);
    for (const p of profiles ?? []) {
      const parts = [p.first_name, p.last_name].filter(Boolean) as string[];
      profilesById.set(p.id, parts.length > 0 ? parts.join(" ") : "—");
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Trash — sub-list под /knowledge; breadcrumb «← База знаний»
          в топбаре даёт явный способ вернуться (sidebar тоже работает,
          но breadcrumb привычнее для sub-routes). */}
      <PageBreadcrumb>
        <Link
          href="/knowledge"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          База знаний
        </Link>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
        <header className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Trash2 className="w-[22px] h-[22px] text-muted-foreground" />
            <h1 className="text-[28px] font-bold tracking-tight leading-tight">
              Корзина
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Удалённые страницы можно восстановить. При удалении родителя
            все подстраницы удаляются вместе с ним; при восстановлении —
            возвращаются в той же иерархии
          </p>
        </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Корзина пуста"
          description="Здесь появляются страницы, которые вы удалили. Они хранятся пока их не восстановят или не удалят навсегда."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.id}>
              <TrashItemRow
                id={row.id}
                title={row.title}
                icon={row.icon}
                iconColor={row.icon_color}
                descendantsCount={row.descendants_count}
                deletedAt={row.deleted_at}
                deletedByName={
                  row.deleted_by ? profilesById.get(row.deleted_by) ?? null : null
                }
              />
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
