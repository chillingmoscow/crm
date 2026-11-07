"use client";

import { useState } from "react";
import { Archive, Copy, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TableControls,
  TableRowMenu,
  type TableRowMenuAction,
} from "@/components/shared/table";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import type { ShiftTemplate } from "@/lib/schedule/types";
import { paletteBg } from "@/lib/palette";
import { cn } from "@/lib/utils";
import styles from "@/components/people/people-table.module.css";
import { TaskHeaderActions } from "./task-header-actions";
import { formatTemplateTimes } from "./editors";

export function TemplateList({
  templates,
  can,
  onCreate,
  onEdit,
  onCopy,
  onArchive,
}: {
  templates: ShiftTemplate[];
  can: (permission: string) => boolean;
  onCreate: () => void;
  onEdit: (template: ShiftTemplate) => void;
  onCopy: (template: ShiftTemplate) => void;
  onArchive: (template: ShiftTemplate) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [status, setStatus] = useState("");
  const rows = templates.filter(
    (t) =>
      t.archived === (status === "archived") &&
      t.name
        .toLocaleLowerCase("ru")
        .includes(query.trim().toLocaleLowerCase("ru")),
  );
  const actions = (t: ShiftTemplate): TableRowMenuAction[] => [
    ...(can("template_edit")
      ? [{ label: "Изменить", icon: <Pencil />, onSelect: () => onEdit(t) }]
      : []),
    ...(can("template_copy")
      ? [{ label: "Создать копию", icon: <Copy />, onSelect: () => onCopy(t) }]
      : []),
    ...(can("template_archive")
      ? [
          {
            label: t.archived ? "Восстановить" : "В архив",
            icon: <Archive />,
            onSelect: () => onArchive(t),
            separatorBefore: true,
          },
        ]
      : []),
  ];
  const name = (t: ShiftTemplate) => (
    <div className="flex items-center gap-3">
      <span
        className={cn("size-2.5 shrink-0 rounded-full", paletteBg(t.color))}
      />
      <button
        className="text-left font-medium hover:text-brand"
        onClick={() => onEdit(t)}
      >
        {t.name}
      </button>
    </div>
  );
  return (
    <div className="space-y-4">
      <TaskHeaderActions>
        <TableControls
          search={{
            value: query,
            onChange: setQuery,
            open: searchOpen,
            onOpenChange: setSearchOpen,
            placeholder: "Найти шаблон смены",
          }}
          primaryActions={
            can("template_create") && (
              <Button size="sm" onClick={onCreate}>
                <Plus className="mr-2 size-4" />
                Новый шаблон
              </Button>
            )
          }
        />
      </TaskHeaderActions>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-muted-foreground">
          Шаблонов: {rows.length}
        </p>
        <TableFilterChip
          label="Статус"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "Активные" },
            { value: "archived", label: "Архив" },
          ]}
        />
      </div>
      <div className={styles.scroll}>
        <table className={styles.table} aria-label="Шаблоны смен">
          <thead className="h-11 bg-muted/70 text-xs text-muted-foreground">
            <tr>
              <th className="w-[25%] px-3 font-medium">Название</th>
              <th className="w-[43%] px-3 font-medium">Время по дням недели</th>
              <th className="px-3 font-medium">Перерыв</th>
              <th className="px-3 font-medium">Ранний приход</th>
              <th className="w-12">
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>{name(t)}</td>
                <td className="text-muted-foreground">
                  {formatTemplateTimes(t)}
                </td>
                <td>{t.break_minutes} мин</td>
                <td>{t.arrival_minutes} мин</td>
                <td>
                  {actions(t).length > 0 && (
                    <TableRowMenu actions={actions(t)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Шаблоны не найдены
          </p>
        )}
      </div>
      <div className={styles.mobileCards}>
        {rows.map((t) => (
          <div className={styles.mobileCard} key={t.id}>
            <div className="flex items-center justify-between gap-3">
              {name(t)}
              {actions(t).length > 0 && <TableRowMenu actions={actions(t)} />}
            </div>
            <dl className={styles.cardFields}>
              <div>
                <dt>Время</dt>
                <dd>{formatTemplateTimes(t)}</dd>
              </div>
              <div>
                <dt>Перерыв</dt>
                <dd>{t.break_minutes} мин</dd>
              </div>
              <div>
                <dt>Ранний приход</dt>
                <dd>{t.arrival_minutes} мин</dd>
              </div>
            </dl>
          </div>
        ))}
        {!rows.length && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Шаблоны не найдены
          </p>
        )}
      </div>
    </div>
  );
}
