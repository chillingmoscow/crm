"use client";
import { useEffect, useState } from "react";
import {
  ExternalLink,
  FileText,
  Package,
  Tag,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryItem,
  DrawerSummaryTotal,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { Skeleton } from "@/components/ui/skeleton";
import { Money, formatRub } from "@/components/shared/money";
import { formatDayMonth } from "@/lib/format/date";
import { personalConsumptionPlan } from "@/lib/stock/writeoffs";
import type { WriteoffRow } from "@/lib/stock/writeoff-view";
import type { WriteoffPoolAssignment } from "@/lib/stock/writeoff-pools";
import { PoolSection, useWriteoffPoolForm } from "./pool-section";
import {
  loadWriteoffHistory,
  type WriteoffData,
  type WriteoffHistory,
} from "./actions";
import {
  writeoffQuantity,
  writeoffStamp,
  writeoffStatusTone,
} from "./writeoff-format";

const events: Record<string, string> = {
  imported: "Получен из Quick Resto",
  updated: "Обновлён из Quick Resto",
  source_removed: "Больше не найден в источнике",
  source_restored: "Снова найден в источнике",
};

const warningClass =
  "rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm";

/** Панель просмотра акта списания или архивной записи (DS § «Боковая панель», тип Б). */
export function WriteoffDrawer({
  row,
  data,
  canAssign,
  onAssign,
  onClose,
}: {
  row: WriteoffRow;
  data: WriteoffData;
  canAssign: boolean;
  onAssign: (
    row: WriteoffRow,
    pool: WriteoffPoolAssignment["pool"] | null,
    key: string | null,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<WriteoffHistory[] | null>(null),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (row.native)
      void loadWriteoffHistory(data.venueId, row.id)
        .then((h) => active && setHistory(h))
        .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [row.id, row.native, data.venueId, attempt]);
  const form = useWriteoffPoolForm(row, (pool, key) =>
    onAssign(row, pool, key),
  );
  const d = row.native?.payload,
    plan = d ? personalConsumptionPlan(d, data.rules?.personalFinance) : null;
  const sourceUrl =
    row.archive?.document_url ??
    (d && data.providerOrigin
      ? `${data.providerOrigin}/#/warehouse.documents.discard?id=${d.id}&className=ru.edgex.quickresto.modules.warehouse.documents.discard.DiscardInvoice&tab=general`
      : null);
  const tz = data.timezone;
  const assignable = canAssign && !!row.native;
  const totalHint =
    row.total !== null
      ? undefined
      : d && !d.processed
        ? "Сумма появится, когда акт проведут в Quick Resto"
        : "Источник не передал сумму";

  const footer =
    assignable || sourceUrl ? (
      <>
        {assignable && form.mark && (
          <Button
            variant="outline"
            className="mr-auto min-w-32"
            disabled={form.busy !== null}
            onClick={() => void form.clear()}
          >
            {form.busy === "clear" ? "Снимаем…" : "Снять разнесение"}
          </Button>
        )}
        {sourceUrl && (
          <Button variant="outline" asChild>
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 size-4" />
              Акт в Quick Resto
            </a>
          </Button>
        )}
        {assignable && (
          <Button
            className="min-w-32"
            disabled={!form.canSave}
            onClick={() => void form.save()}
          >
            {form.busy === "save" ? "Сохраняем…" : "Сохранить"}
          </Button>
        )}
      </>
    ) : undefined;

  return (
    <EditDrawer
      open
      title={row.name}
      description={[
        formatDayMonth(row.date),
        row.archive ? "Архив Glide" : row.store,
      ]
        .filter(Boolean)
        .join(" · ")}
      titleAccessory={
        <DrawerStatus label={row.status} tone={writeoffStatusTone(row.status)} />
      }
      footer={footer}
      onOpenChange={(v) => !v && onClose()}
    >
      <DrawerSummary label={d ? "Данные акта" : "Данные записи"}>
        <DrawerSummaryTotal
          label={d ? "Сумма акта" : "Сумма записи"}
          hint={totalHint}
        >
          <Money value={row.total} fraction />
        </DrawerSummaryTotal>
        {row.correspondent && row.correspondent !== row.kind && (
          <DrawerSummaryItem icon={<UserRound />} label="Кому относится">
            {row.correspondent}
          </DrawerSummaryItem>
        )}
        {row.kind && (
          <DrawerSummaryItem icon={<Tag />} label="Тип">
            {row.kind}
          </DrawerSummaryItem>
        )}
        {row.reason && row.reason !== "—" && (
          <DrawerSummaryItem icon={<FileText />} label="Основание / категория">
            {row.reason}
          </DrawerSummaryItem>
        )}
        {row.quantity && (
          <DrawerSummaryItem icon={<Package />} label="Недостача">
            {row.quantity}
          </DrawerSummaryItem>
        )}
        {row.archive?.deleted && row.archive.delete_reason && (
          <DrawerSummaryItem icon={<Trash2 />} label="Причина удаления">
            {row.archive.delete_reason}
          </DrawerSummaryItem>
        )}
      </DrawerSummary>
      {!!row.issues.length && (
        <div role="note" className={`${warningClass} space-y-1`}>
          {row.issues.map((i) => (
            <p key={i}>{i}</p>
          ))}
        </div>
      )}
      <PoolSection row={row} data={data} canAssign={canAssign} form={form} />
      {d?.kind === "personal" && (
        <DrawerSection title="Личное потребление">
          {plan?.eligible ? (
            <>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Приход</dt>
                  <dd>
                    <Money value={plan.amount} fraction />
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Расход</dt>
                  <dd>
                    <Money value={plan.amount} fraction />
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                По прежнему правилу Adesk сумма каждой позиции округляется
                отдельно. Остаток счёта не меняется.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {plan?.issues.join(". ")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Это расчёт для сверки. Денежные операции из этой карточки пока не
            создаются.
          </p>
        </DrawerSection>
      )}
      {d && (
        <DrawerSection title={`Позиции · ${d.lines.length}`}>
          <ul className="divide-y">
            {d.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="break-words font-medium">{l.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {l.quantity === null
                      ? "Количество не указано"
                      : `${writeoffQuantity(l.quantity)} ${l.unit ?? ""}`.trim()}
                  </p>
                  {!!l.categories.length && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {l.categories[0]}
                    </p>
                  )}
                </div>
                <Money value={l.amount} fraction className="shrink-0" />
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
      <DrawerSection title="История изменений">
        {row.archive ? (
          <div className="space-y-2 text-sm">
            <p>
              Перенесено из Glide · {writeoffStamp(row.archive.captured_at, tz)}
            </p>
            <a
              className="inline-flex items-center gap-1 text-brand hover:underline"
              target="_blank"
              rel="noreferrer"
              href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(row.archive.origin.spreadsheet_id)}/edit#range=${encodeURIComponent(row.archive.origin.range)}`}
            >
              Исходная строка
              <ExternalLink className="size-3.5" />
            </a>
            {row.archive.period_total_raw != null && (
              <p className="text-xs text-muted-foreground">
                В источнике есть поле «Сумма списаний»:{" "}
                {formatRub(row.archive.period_total_raw, { fraction: "auto" })}.
                Значение повторяется в строках источника и к сумме этой записи
                не прибавляется.
              </p>
            )}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p>Не удалось загрузить историю</p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setError(false);
                setHistory(null);
                setAttempt((n) => n + 1);
              }}
            >
              Повторить
            </Button>
          </div>
        ) : history === null ? (
          <div role="status" aria-label="Загружаем историю" className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Изменений пока нет</p>
        ) : (
          <DrawerTimeline>
            {history.map((h, index) => (
              <DrawerTimelineItem
                key={h.id}
                last={index === history.length - 1}
                avatar={<DrawerAvatar name={h.actor_name ?? ""} />}
                title={events[h.action] ?? "Изменение"}
                meta={[h.actor_name, writeoffStamp(h.created_at, tz)]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <p className="tabular-nums">
                  Сумма:{" "}
                  {h.before_payload
                    ? `${formatRub(h.before_payload.total, { fraction: true })} → `
                    : ""}
                  {formatRub(h.after_payload?.total ?? null, { fraction: true })}
                </p>
              </DrawerTimelineItem>
            ))}
          </DrawerTimeline>
        )}
      </DrawerSection>
      {row.native && (
        <p className="text-xs text-muted-foreground">
          Снимок Quick Resto · {writeoffStamp(row.native.captured_at, tz)}
        </p>
      )}
    </EditDrawer>
  );
}
