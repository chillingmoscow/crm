"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Barcode, Building2, CalendarClock, FileText, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryItem,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { TableRowMenu, type TableRowMenuAction } from "@/components/shared/table";
import { countRu } from "@/lib/format/plural";
import {
  STORE_SETUP_STATUS_HINT,
  STORE_SETUP_STATUS_LABEL,
  type StoreSetupStatus,
} from "@/lib/inventory/store-setup-status";
import {
  listStoreHistory,
  type StoreDepartmentScope,
  type StoreHistoryChange,
  type StoreHistoryEntry,
} from "../actions";

const HISTORY_PAGE = 10;

const SCOPE_LABEL = { unset: "Не задано", shared: "Общий склад" } as const;

function bindingLabel(scope: StoreDepartmentScope, departmentName: string | null) {
  if (scope === "department") return departmentName ?? "подразделение удалено";
  return SCOPE_LABEL[scope];
}

function entryTitle(change: StoreHistoryChange): string {
  switch (change.kind) {
    case "venue":
      return change.to ? "Выбрано заведение" : "Снята привязка к заведению";
    case "department":
      return change.toScope === "department"
        ? "Выбрано подразделение"
        : change.toScope === "shared"
          ? "Склад сделан общим"
          : "Подразделение снято";
    case "archived":
      return "Склад отправлен в архив";
    case "restored":
      return "Склад возвращён из архива";
  }
}

function changeLine(change: StoreHistoryChange): string | null {
  switch (change.kind) {
    case "venue":
      return `Заведение: ${change.from ?? "Не привязан"} → ${change.to ?? "Не привязан"}`;
    case "department":
      return `Подразделение: ${bindingLabel(change.fromScope, change.fromName)} → ${bindingLabel(change.toScope, change.toName)}`;
    default:
      return null;
  }
}

const when = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});
const dayThisYear = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });
const dayWithYear = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });
/** «20 ноября», а для прошлых лет — «20 ноября 2025» (без «г.», как в лентах). */
function formatDay(iso: string): string {
  const date = new Date(iso);
  return date.getFullYear() === new Date().getFullYear()
    ? dayThisYear.format(date)
    : dayWithYear.format(date).replace(/\s*г\.$/, "");
}

export type StoreDrawerData = {
  id: string;
  title: string;
  code: string | null;
  description: string | null;
  venueLabel: string;
  departmentLabel: string;
  status: StoreSetupStatus;
  archivedAt: string | null;
  stats: { count: number; lastActAt: string | null } | null;
  missingInSource: boolean;
};

/**
 * Карточка склада — панель просмотра (docs/design-system.md, «Боковая панель → Б»):
 * сводка, история изменений, в подвале — переход к актам склада, редкие
 * действия (архив) — в меню «⋯» шапки. Привязки правятся прямо в таблице,
 * поэтому полей ввода здесь нет.
 */
export function StoreDrawer({
  store,
  onOpenChange,
  menu,
  canViewHistory,
  canViewDocuments,
}: {
  store: StoreDrawerData | null;
  onOpenChange: (open: boolean) => void;
  menu: TableRowMenuAction[];
  /** Видны ли изменения подразделения (право на результаты инвентаризации). */
  canViewHistory: boolean;
  canViewDocuments: boolean;
}) {
  const storeId = store?.id ?? null;
  const [history, setHistory] = useState<{ storeId: string; entries: StoreHistoryEntry[]; error: string | null } | null>(
    null,
  );
  const [visible, setVisible] = useState(HISTORY_PAGE);
  const [attempt, setAttempt] = useState(0);

  // Историю читаем при открытии и после правки привязки или архива: иначе
  // свежее изменение в ней не появилось бы.
  const bindingKey = store
    ? `${store.id}:${store.departmentLabel}:${store.venueLabel}:${store.archivedAt ?? ""}`
    : null;
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    listStoreHistory(storeId)
      .then((result) => {
        if (!cancelled) setHistory({ storeId, ...result });
      })
      .catch(() => {
        if (!cancelled) setHistory({ storeId, entries: [], error: "Не удалось загрузить историю" });
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, bindingKey, attempt]);

  useEffect(() => {
    setVisible(HISTORY_PAGE);
  }, [storeId]);

  const current = history && history.storeId === storeId ? history : null;
  const shown = current?.entries.slice(0, visible) ?? [];

  return (
    <EditDrawer
      open={Boolean(store)}
      onOpenChange={onOpenChange}
      title={store?.title ?? "Склад"}
      description="Склад Quick Resto"
      titleAccessory={
        store ? (
          store.archivedAt ? (
            <DrawerStatus label="В архиве" />
          ) : (
            <DrawerStatus
              label={STORE_SETUP_STATUS_LABEL[store.status]}
              tone={store.status === "ready" ? "success" : "warning"}
            />
          )
        ) : null
      }
      headerActions={menu.length > 0 ? <TableRowMenu actions={menu} label="Действия со складом" /> : null}
      footer={
        store && canViewDocuments ? (
          <Button asChild variant="outline">
            <Link href={`/documents/inventory?store=${store.id}`}>
              <FileText className="size-4" />
              Акты склада
            </Link>
          </Button>
        ) : undefined
      }
    >
      {store ? (
        <>
          <DrawerSummary label="О складе">
            <DrawerSummaryItem icon={<Building2 />} label="Заведение">
              {store.venueLabel}
            </DrawerSummaryItem>
            <DrawerSummaryItem icon={<Users />} label="Кто платит за недостачу">
              {store.departmentLabel}
            </DrawerSummaryItem>
            <DrawerSummaryItem icon={<CalendarClock />} label="Последний акт">
              {store.stats?.lastActAt
                ? `${formatDay(store.stats.lastActAt)} · ${countRu(store.stats.count, "акт", "акта", "актов")}`
                : "Актов пока не было"}
            </DrawerSummaryItem>
            {store.code ? (
              <DrawerSummaryItem icon={<Barcode />} label="Код в Quick Resto">
                {store.code}
              </DrawerSummaryItem>
            ) : null}
          </DrawerSummary>

          {store.archivedAt ? (
            <p className="text-sm text-muted-foreground">
              В архиве с {formatDay(store.archivedAt)}. Склада нет в списке, акты и расчёт недостачи по
              нему не изменились.
            </p>
          ) : store.status !== "ready" ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status">
              {STORE_SETUP_STATUS_HINT[store.status]}
            </div>
          ) : null}
          {store.missingInSource && !store.archivedAt ? (
            <p className="text-sm text-muted-foreground">
              При последней синхронизации склада не было в Quick Resto. Если он больше не нужен, отправьте его в
              архив через меню «⋯».
            </p>
          ) : null}

          {store.description ? (
            <DrawerSection title="Описание">
              <p className="whitespace-pre-wrap text-sm">{store.description}</p>
            </DrawerSection>
          ) : null}

          <DrawerSection title="История изменений">
            {!current ? (
              <div className="space-y-3" aria-label="Загрузка истории">
                {[0, 1].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
                ))}
              </div>
            ) : current.error ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-destructive">{current.error}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  Повторить
                </Button>
              </div>
            ) : current.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Склад ещё не меняли</p>
            ) : (
              <>
                <DrawerTimeline>
                  {shown.map((entry, index) => {
                    const name = entry.actor
                      ? `${entry.actor.name}${entry.actor.isMe ? " (вы)" : ""}`
                      : "Автоматически";
                    const lines = entry.changes.map(changeLine).filter((line): line is string => Boolean(line));
                    return (
                      <DrawerTimelineItem
                        key={entry.id}
                        last={index === shown.length - 1}
                        avatar={<DrawerAvatar name={entry.actor?.name ?? "Система"} src={entry.actor?.avatarUrl} />}
                        title={entryTitle(entry.changes[0])}
                        meta={`${name} · ${when.format(new Date(entry.changedAt))}`}
                      >
                        {lines.length > 0 ? (
                          <>
                            {lines.map((line) => (
                              <p key={line}>{line}</p>
                            ))}
                            {/* Без автора подразделение сбрасывает база: удалили
                                подразделение или заведение склада. */}
                            {!entry.actor && entry.changes[0].kind === "department" ? (
                              <p className="text-muted-foreground">
                                Сброшено при удалении подразделения или заведения
                              </p>
                            ) : null}
                          </>
                        ) : null}
                      </DrawerTimelineItem>
                    );
                  })}
                </DrawerTimeline>
                {current.entries.length > visible ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 text-muted-foreground"
                    onClick={() => setVisible((n) => n + HISTORY_PAGE)}
                  >
                    Показать ещё
                  </Button>
                ) : null}
              </>
            )}
            {!canViewHistory ? (
              <p className="text-xs text-muted-foreground">
                Изменения подразделения видны тем, кому доступны результаты инвентаризации
              </p>
            ) : null}
          </DrawerSection>
        </>
      ) : null}
    </EditDrawer>
  );
}
