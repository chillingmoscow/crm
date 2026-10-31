"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  loadCashMovements,
  requestCashMovements,
  loadMovementHistory,
  type MovementDayData,
  type MovementHistoryEntry,
} from "../cash-movement-actions";
import { money } from "@/lib/sales/format";
const stamp = (s: string) => new Date(s).toLocaleString("ru-RU");
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
            e instanceof Error
              ? e.message
              : "Не удалось загрузить кассовые операции",
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
        e instanceof Error ? e.message : "Не удалось запустить сверку",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!data && !error) return null;
  return (
    <section className="space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Инкассации и внесения</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Операции кассовой смены. Денежные записи пока создаёт n8n.
          </p>
        </div>
        {data?.canManage && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || pending}
            onClick={() => void request()}
          >
            {busy || pending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            {pending ? "Сверяем" : "Сверить"}
          </Button>
        )}
      </div>
      {(error || data?.job?.error || data?.problem) && (
        <p role="alert" className="text-sm text-destructive">
          {error || data?.job?.error || data?.problem}
        </p>
      )}
      {pending && (
        <p role="status" className="text-xs text-muted-foreground">
          {data?.job?.phase === "verify"
            ? "Повторно проверяем полный список операций."
            : "Загружаем операции с учётом поздних выгрузок."}
        </p>
      )}
      {data && !data.configured && (
        <p className="text-xs text-muted-foreground">
          Для сверки проводок выберите счета и статьи в{" "}
          <Link
            className="text-primary hover:underline"
            href={`/org/venues/${venueId}?tab=sales`}
          >
            настройках заведения
          </Link>
          .
        </p>
      )}
      {data?.checkedAt && (
        <p className="text-xs text-muted-foreground">
          Проверено {stamp(data.checkedAt)} · {data.items.length} операций
        </p>
      )}
      {!!data?.job?.outside?.length && (
        <details className="rounded-xl border border-amber-200 p-3 text-xs">
          <summary className="cursor-pointer text-amber-800">
            Поздние операции вне периода · {data.job.outside.length}
          </summary>
          <p className="mt-2 text-muted-foreground">
            Для полной сверки этих дней откройте исходную дату.
          </p>
          <div className="mt-2 space-y-1">
            {data.job.outside.map((o) => (
              <p key={o.id}>
                <Link
                  className="text-primary hover:underline"
                  href={`/sales/shifts?day=${o.date}`}
                >
                  #{o.id} · {o.date}
                </Link>
              </p>
            ))}
          </div>
        </details>
      )}
      {!!data?.items.length && (
        <div className="divide-y rounded-xl border">
          {data.items.map((row) => {
            const checks = data.rows.filter((r) =>
                r.plan.sourceIds.includes(row.id),
              ),
              review = data.review.find((r) => r.sourceId === row.id);
            return (
              <div key={row.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {row.comment ||
                        (row.type === "cashIn" ? "Внесение" : "Изъятие")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Quick Resto #{row.id}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {row.type === "cashIn" ? "+" : "−"}
                    {money(row.amountCents / 100)} ₽
                  </span>
                </div>
                {review && (
                  <p className="text-xs text-amber-700">{review.message}</p>
                )}
                {checks.map((check) => (
                  <p
                    key={check.plan.key}
                    className={`text-xs ${check.state === "matched" ? "text-emerald-700" : check.state === "conflict" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {check.plan.label} ·{" "}
                    {check.state === "matched"
                      ? "совпадает"
                      : check.state === "conflict"
                        ? "требует сверки"
                        : "нет в Sheerly"}
                    {check.state === "conflict" &&
                      ` · ${check.problems.join("; ")}`}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {data?.checkedAt && !data.items.length && (
        <p className="text-sm text-muted-foreground">
          Кассовых операций за этот день нет.
        </p>
      )}
      {data && !data.checkedAt && !pending && !error && (
        <p className="text-sm text-muted-foreground">
          Кассовые операции ещё не загружены.
        </p>
      )}
    </section>
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
      .catch((e) => {
        if (live) setError(e.message);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить историю");
    } finally {
      setBusy(false);
    }
  };
  if (!allowed && !error) return null;
  return (
    <section className="space-y-4 border-t pt-5">
      <h3 className="text-sm font-semibold">История инкассаций и внесений</h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows?.map((entry) => (
        <details key={entry.id} className="rounded-xl border p-4 text-sm">
          <summary className="cursor-pointer">
            Версия {entry.version} · {entry.actor_name}
            <span className="mt-1 block text-xs text-muted-foreground">
              {stamp(entry.created_at)}
            </span>
          </summary>
          <div className="mt-3 divide-y">
            {entry.items.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-3 py-2 text-xs"
              >
                <span className="min-w-0 break-words">
                  #{row.id} ·{" "}
                  {row.comment ||
                    (row.type === "cashIn" ? "Внесение" : "Изъятие")}
                </span>
                <span className="shrink-0 tabular-nums">
                  {money(row.amountCents / 100)} ₽
                </span>
              </div>
            ))}
            {!entry.items.length && (
              <p className="text-muted-foreground">
                Кассовых операций не было.
              </p>
            )}
          </div>
        </details>
      ))}
      {rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Кассовые операции ещё не загружены.
        </p>
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
    </section>
  );
}
