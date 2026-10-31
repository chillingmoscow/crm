"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  loadSettlementPanel,
  requestSettlement,
  type SettlementPanelData,
} from "../settlement-actions";
import { money } from "@/lib/sales/format";
const labels: Record<string, string> = {
  matched: "Совпадает",
  changed: "Сумма или реквизиты отличаются",
  review: "Нужна проверка",
  missing: "Нет операции в Sheerly",
  cancelled: "Отменено вручную",
};
export function SettlementPanel({
  venueId,
  date,
}: {
  venueId: string;
  date: string;
}) {
  const [data, setData] = useState<SettlementPanelData | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const running =
    data?.job?.state === "pending" || data?.job?.state === "running";
  useEffect(() => {
    let live = true;
    const load = () =>
      loadSettlementPanel(venueId, date)
        .then((d) => {
          if (live) {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void load();
      },
      running ? 5000 : 30000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [venueId, date, running]);
  const request = async () => {
    setBusy(true);
    try {
      await requestSettlement(venueId, date);
      setData(await loadSettlementPanel(venueId, date));
      toast.success("Проверка поступлений поставлена в очередь");
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
          <h3 className="text-sm font-semibold">Поступления по счетам</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Сверка с финансами Sheerly. Операции создаёт n8n.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || running || !data}
          onClick={() => void request()}
        >
          {busy || running ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          {running ? "Читаем чеки" : "Сверить"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {running && (
        <p role="status" className="text-xs text-muted-foreground">
          {data?.job?.phase === "verify"
            ? "Проверяем полноту списка"
            : data?.job?.phase === "orders"
              ? "Загружаем список чеков"
              : `${data?.job?.pass === 2 ? "Повторная проверка" : "Проверяем чеки"}: ${Math.min(data?.job?.cursor ?? 0, data?.job?.total ?? 0)} из ${data?.job?.total ?? 0}`}
          . Сохранённый результат останется до завершения.
        </p>
      )}
      {data?.job?.error && (
        <p role="alert" className="text-sm text-destructive">
          {data.job.error}
        </p>
      )}
      {data?.checkedAt && (
        <p className="text-xs text-muted-foreground">
          Чеков: {data.receipts} · проверено{" "}
          {new Date(data.checkedAt).toLocaleString("ru-RU")}
        </p>
      )}
      {data && !data.configured && (
        <p className="text-sm text-muted-foreground">
          Для расчёта выберите счета, статьи и комиссии в{" "}
          <Link
            className="text-brand hover:underline"
            href={`/org/venues/${venueId}?tab=sales`}
          >
            настройках заведения
          </Link>
          .
        </p>
      )}
      {data?.problem && (
        <p role="alert" className="text-sm text-destructive">
          {data.problem}
        </p>
      )}
      {data?.rows.map((r) => (
        <div
          key={r.key}
          className="flex items-start justify-between gap-3 border-b pb-3 text-sm"
        >
          <div className="min-w-0">
            <p>{r.bank}</p>
            <p className="mt-1 text-xs text-muted-foreground">{r.label}</p>
            <p
              className={`mt-1 text-xs ${r.state === "matched" ? "text-emerald-600" : r.state === "cancelled" ? "text-muted-foreground" : "text-amber-600"}`}
            >
              {labels[r.state] ?? "Нужна проверка"}
            </p>
          </div>
          <span className="shrink-0 font-medium tabular-nums">
            {money(r.amount)}
          </span>
        </div>
      ))}
      {!!data?.extraCount && (
        <p className="text-sm text-amber-600">
          Лишних операций для проверки: {data.extraCount}
        </p>
      )}
      {!!data?.excludedAmount && (
        <p className="text-xs text-muted-foreground">
          Бонусы и оплата без поступления: {money(data.excludedAmount)}
        </p>
      )}
      {data?.version && !data.problem && data.configured && data.ready && (
        <p className="text-xs text-emerald-600">
          Расхождений с сохранёнными операциями нет.
        </p>
      )}
    </section>
  );
}
