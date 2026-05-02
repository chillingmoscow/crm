import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listDeletedKbPages } from "@/lib/knowledge/pages";
import { Card } from "@/components/ui/card";
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
    <div className="flex flex-col gap-6 px-8 py-6 max-w-4xl mx-auto">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Trash2 className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Корзина</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Удалённые страницы можно восстановить. Подстраницы удалённой
          родительской страницы при удалении временно становятся корневыми
          в основном дереве — восстановление родителя их не вернёт обратно
          в иерархию.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-12 text-center">
          <Trash2 className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Корзина пуста</p>
          <p className="text-sm text-muted-foreground">
            Здесь появляются страницы, которые вы удалили. Они хранятся
            пока их не восстановят или не удалят навсегда.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.id}>
              <TrashItemRow
                id={row.id}
                title={row.title}
                icon={row.icon}
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
  );
}
