"use client";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  loadCashControl,
  requestCashControl,
  type CashDayData,
} from "../cash-control-actions";
import { money } from "@/lib/sales/format";
const states = {
  unknown: "Нет подтверждённых данных",
  matched: "Совпадает",
  tolerated: "В пределах порога",
  shortage: "Недостача",
  overage: "Излишек",
};
export function CashControlPanel({
  venueId,
  date,
}: {
  venueId: string;
  date: string;
}) {
  const [data, setData] = useState<CashDayData | null>(null),
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
        const d = await loadCashControl(venueId, date);
        if (live) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (live)
          setError(
            e instanceof Error
              ? e.message
              : "Не удалось загрузить контроль кассы",
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
      await requestCashControl(venueId, date);
      setData(await loadCashControl(venueId, date));
      toast.success("Проверка кассы запущена");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось запустить проверку",
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
          <h3 className="text-sm font-semibold">Контроль кассы</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Расчётный и заявленный остаток при открытии и закрытии.
          </p>
        </div>
        {data?.canManage && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending || busy}
            onClick={() => void request()}
          >
            {pending || busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            {pending ? "Проверяем" : "Проверить кассу"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {data?.job?.error && (
        <p role="alert" className="text-sm text-destructive">
          {data.job.error}
        </p>
      )}
      {data?.problem && (
        <p role="alert" className="text-sm text-destructive">
          {data.problem}
        </p>
      )}
      {pending && (
        <p role="status" className="text-xs text-muted-foreground">
          {data?.job?.phase === "verify"
            ? "Повторно проверяем кассовые отчёты."
            : "Загружаем кассовые отчёты."}
        </p>
      )}
      {!data?.checkedAt && !pending && !error && (
        <p className="text-sm text-muted-foreground">
          Кассовые отчёты за этот день ещё не проверены.
        </p>
      )}
      {data?.checkedAt && (
        <p className="text-xs text-muted-foreground">
          Проверено {new Date(data.checkedAt).toLocaleString("ru-RU")} · порог{" "}
          {money(data.rules.thresholdCents / 100)} ₽
        </p>
      )}
      {data?.reports.map((report) => (
        <div key={report.id} className="space-y-3 rounded-xl border p-4">
          <div>
            <p className="text-sm font-medium">
              {report.terminal} · смена №{report.shiftNumber ?? report.id}
            </p>
            {report.cashier && report.cashier !== "Не указан" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {report.cashier}
              </p>
            )}
          </div>
          {data.results
            .filter((r) => r.reportId === report.id)
            .map((row) => (
              <div key={row.key} className="border-t pt-3">
                <div className="flex justify-between gap-2 text-sm">
                  <span>{row.kind === "open" ? "Открытие" : "Закрытие"}</span>
                  <span
                    className={`text-right ${row.state === "shortage" ? "text-destructive" : row.state === "overage" ? "text-amber-600" : row.state === "matched" ? "text-emerald-600" : "text-muted-foreground"}`}
                  >
                    {states[row.state]}
                    {row.diff !== null && row.diff !== 0
                      ? ` · ${row.diff > 0 ? "+" : ""}${money(row.diff / 100)}`
                      : ""}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <dt>Расчёт, ₽</dt>
                    <dd className="mt-1 text-sm text-foreground tabular-nums">
                      {money(row.expected === null ? null : row.expected / 100)}
                    </dd>
                  </div>
                  <div>
                    <dt>Указано кассиром, ₽</dt>
                    <dd className="mt-1 text-sm text-foreground tabular-nums">
                      {money(row.declared === null ? null : row.declared / 100)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          {report.incomplete && (
            <p className="text-xs text-amber-600">
              Кассовый отчёт отмечен как неполный.
            </p>
          )}
        </div>
      ))}
      {data?.checkedAt && data.reports.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Кассовых смен за этот рабочий день нет.
        </p>
      )}
    </section>
  );
}
