import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import { Trash2 } from "lucide-react";

import {
  createClient,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { listDeletedKbPages } from "@/lib/knowledge/pages";
import { EmptyState } from "@/components/ui/empty-state";
import { KbTrashClient } from "@/app/(dashboard)/knowledge/trash/_components/kb-trash-client";
import { KbEmptyTrashButton } from "@/app/(dashboard)/knowledge/trash/_components/kb-empty-trash-button";
import type { TrashRow } from "@/app/(dashboard)/knowledge/trash/_components/trash-item-row";

/**
 * Корзина базы знаний. Доступ — только под `kb.delete_pages` (та же
 * permission, что и удаление; видимость soft-deleted строк гейтится
 * там же на уровне RLS — миграция 050 / 046).
 *
 * Восстановление — `restoreKbPage` через TrashItemRow (client).
 * Hard-delete и автопурж по 30-дневному таймеру вне MVP.
 */
export const metadata: Metadata = { title: "Корзина базы знаний" };

export default async function KnowledgeTrashPage() {
  const can = await getCachedPermissionChecker();
  if (!can("kb.delete_pages")) redirect("/knowledge");

  const supabase = await createClient();

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

  const trashRows: TrashRow[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    icon: row.icon,
    iconColor: row.icon_color,
    descendantsCount: row.descendants_count,
    deletedAt: row.deleted_at,
    deletedByName: row.deleted_by
      ? profilesById.get(row.deleted_by) ?? null
      : null,
  }));

  return (
    <PageFrame className="flex flex-col gap-6">
          <Breadcrumbs
            items={[
              { label: "База знаний", href: "/knowledge" },
              { label: "Корзина" },
            ]}
          />
          <TablePageHeader
            title="Корзина"
            actions={
              rows.length > 0 ? (
                <KbEmptyTrashButton count={rows.length} />
              ) : undefined
            }
          />

          {rows.length === 0 ? (
            <EmptyState
              icon={Trash2}
              title="Корзина пуста"
              description="Здесь появляются страницы, которые вы удалили. Они хранятся, пока их не восстановят или не удалят навсегда."
            />
          ) : (
            <KbTrashClient rows={trashRows} />
          )}
    </PageFrame>
  );
}
