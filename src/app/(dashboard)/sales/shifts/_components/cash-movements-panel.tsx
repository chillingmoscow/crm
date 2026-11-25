"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  loadCashMovements,
  requestCashMovements,
  loadMovementHistory,
  type MovementDayData,
  type MovementHistoryEntry,
} from "../cash-movement-actions";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { StatusBadge } from "@/components/ui/status-badge";
import { Money, formatRub } from "@/components/shared/money";
import { formatDateCell, formatDayMonthTime } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { salesErrorText } from "@/lib/sales/errors";
import { SectionRowsSkeleton } from "../../_components/section-skeleton";
export function CashMovementsPanel({
  venueId,
  date,
}: {
  venueId: string;
  date: string;
}) {
  const [data, setData] = useState<MovementDayData | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const pending =
    data?.job?.state === "pending" || data?.job?.state === "running";
  useEffect(() => {
    let live = true,
      fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const d = await loadCashMovements(venueId, date);
        if (live) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (live)
          setError(
            salesErrorText(
              e instanceof Error ? e.message : null,
              "Не удалось загрузить кассовые операции",
            ),
          );
      } finally {
        fetching = false;
      }
    };
    void load();
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void load();
      },
      pending ? 5000 : 30000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [venueId, date, pending]);
  const request = async () => {
    setBusy(true);
    try {
      await requestCashMovements(venueId, date);
      setData(await loadCashMovements(venueId, date));
      toast.success("Сверка инкассаций запущена");
    } catch (e) {
      toast.error(
        salesErrorText(
          e instanceof Error ? e.message : null,
          "Не удалось запустить сверку",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  if (!data && !error)
    return (
      <DrawerSection
        title="Инкассации и внесения"
        description="Инкассации, такси и выдача чаевых по кассовой смене"
      >
        <SectionRowsSkeleton label="Загружаем инкассации и внесения" />
      </DrawerSection>
    );
  const problem =
    error ?? salesErrorText(data?.job?.error) ?? data?.problem ?? null;
  return (
    <DrawerSection
      title="Инкассации и внесения"
      description="Инкассации, такси и выдача чаевых по кассовой смене"
      actions={
        data?.canManage ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={busy || pending}
            onClick={() => void request()}
          >
            <RefreshCw
              className={
                busy || pending
                  ? "size-4 animate-spin motion-reduce:animate-none"
                  : "size-4"
              }
            />
            {pending ? "Сверяем…" : "Сверить"}
          </Button>
        ) : undefined
      }
    >
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {pending && (
        <p role="status" className="text-xs text-muted-foreground">
          {data?.job?.phase === "verify"
            ? "Повторно проверяем полный список операций"
            : "Загружаем операции с учётом поздних выгрузок"}
        </p>
      )}
      {data && !data.configured && (
        <p className="text-sm text-muted-foreground">
          Чтобы сверять проводки, выберите счета и статьи в{" "}
          <Link
            className="text-brand hover:underline"
            href={`/sales/settings?venue=${venueId}`}
          >
            настройках заведения
          </Link>
        </p>
      )}
      {!!data?.job?.outside?.length && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p>
            Поздние операции других дней:{" "}
            {data.job.outside.length}. Для полной сверки откройте их день
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {data.job.outside.map((o) => (
              <li key={o.id}>
                <Link
                  className="text-brand hover:underline"
                  href={`/sales/shifts?day=${o.date}`}
                >
                  {formatDateCell(o.date)} · №{o.id}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!data?.items.length && (
        <ul className="divide-y">
          {data.items.map((row) => {
            const checks = data.rows.filter((r) =>
                r.plan.sourceIds.includes(row.id),
              ),
              review = data.review.find((r) => r.sourceId === row.id);
            return (
              <li key={row.id} className="space-y-1.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {row.comment ||
                        (row.type === "cashIn" ? "Внесение" : "Изъятие")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Quick Resto №{row.id}
                    </p>
                  </div>
                  <Money
                    signed
                    className="shrink-0 text-sm font-medium"
                    value={(row.type === "cashIn" ? 1 : -1) * (row.amountCents / 100)}
                    fraction="auto"
                  />
                </div>
                {review && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {review.message}
                  </p>
                )}
                {checks.map((check) => (
                  <div
                    key={check.plan.key}
                    className="flex flex-wrap items-center gap-2 text-xs"
                  >
                    <span className="text-muted-foreground">
                      {check.plan.label}
                    </span>
                    <StatusBadge
                      tone={
                        check.state === "matched"
                          ? "success"
                          : check.state === "conflict"
                            ? "danger"
                            : "warning"
                      }
                      tip={
                        check.state === "conflict"
                          ? check.problems.join("; ")
                          : undefined
                      }
                    >
                      {check.state === "matched"
                        ? "Совпадает"
                        : check.state === "conflict"
                          ? "Требует сверки"
                          : "Нет в Sheerly"}
                    </StatusBadge>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      {data?.checkedAt && !data.items.length && (
        <p className="text-sm text-muted-foreground">
          Кассовых операций за этот день нет
        </p>
      )}
      {data && !data.checkedAt && !pending && !error && (
        <p className="text-sm text-muted-foreground">
          Кассовые операции ещё не загружены
        </p>
      )}
      {data?.checkedAt && (
        <p className="text-xs text-muted-foreground">
          Проверено {formatDayMonthTime(data.checkedAt)} ·{" "}
          {countRu(data.items.length, "операция", "операции", "операций")}
        </p>
      )}
    </DrawerSection>
  );
}
export function CashMovementHistory({
  venueId,
  date,
}: {
  venueId: string;
  date: string;
}) {
  const [rows, setRows] = useState<MovementHistoryEntry[] | null>(null),
    [allowed, setAllowed] = useState(false),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadMovementHistory(venueId, date)
      .then((d) => {
        if (live) {
          setAllowed(d !== null);
          setRows(d?.rows ?? []);
          setMore(d?.more ?? false);
        }
      })
      .catch(() => {
        if (live) setError("Не удалось загрузить историю");
      });
    return () => {
      live = false;
    };
  }, [venueId, date]);
  const next = async () => {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const d = await loadMovementHistory(
        venueId,
        date,
        rows[rows.length - 1].version,
      );
      setRows((old) => [...(old ?? []), ...(d?.rows ?? [])]);
      setMore(d?.more ?? false);
      setError(null);
    } catch {
      setError("Не удалось загрузить историю");
    } finally {
      setBusy(false);
    }
  };
  // Пока не знаем, доступна ли история, держим место секции; без доступа — убираем.
  if (rows === null && !error)
    return (
      <DrawerSection title="Инкассации и внесения">
        <SectionRowsSkeleton label="Загружаем историю инкассаций" rows={2} />
      </DrawerSection>
    );
  if (!allowed && !error) return null;
  return (
    <DrawerSection title="Инкассации и внесения">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Кассовые операции ещё не загружены
        </p>
      )}
      {!!rows?.length && (
        <DrawerTimeline>
          {rows.map((entry, index) => (
            <DrawerTimelineItem
              key={entry.id}
              last={index === rows.length - 1}
              avatar={<DrawerAvatar name={entry.actor_name} />}
              title={`Версия ${entry.version}`}
              meta={`${entry.actor_name} · ${formatDayMonthTime(entry.created_at)}`}
            >
              {entry.items.map((row) => (
                <p key={row.id} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">
                    №{row.id} ·{" "}
                    {row.comment ||
                      (row.type === "cashIn" ? "Внесение" : "Изъятие")}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatRub(row.amountCents / 100, { fraction: "auto" })}
                  </span>
                </p>
              ))}
              {!entry.items.length && (
                <p className="text-muted-foreground">Кассовых операций не было</p>
              )}
            </DrawerTimelineItem>
          ))}
        </DrawerTimeline>
      )}
      {more && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void next()}
        >
          {busy ? "Загружаем…" : "Показать ещё"}
        </Button>
      )}
    </DrawerSection>
  );
}
