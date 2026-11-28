import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";

import {
  createClient,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { listDeletedKbPages } from "@/lib/knowledge/pages";
import { KbTrashClient } from "@/app/(dashboard)/knowledge/trash/_components/kb-trash-client";
import type { TrashRow } from "@/app/(dashboard)/knowledge/trash/_components/kb-trash-client";

/**
 * Корзина базы знаний. Доступ — только под `kb.delete_pages` (та же
 * permission, что и удаление; видимость soft-deleted строк гейтится
 * там же на уровне RLS — миграция 050 / 046).
 *
 * Восстановление и удаление навсегда — в KbTrashClient. Срока хранения
 * и автоочистки нет: страница лежит, пока её не восстановят или не удалят
 * навсегда (решение 27.11.2026).
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
      <KbTrashClient rows={trashRows} />
    </PageFrame>
  );
}
