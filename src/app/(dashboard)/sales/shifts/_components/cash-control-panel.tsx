"use client";
import { unwrapAction } from "@/lib/actions/result";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Money } from "@/components/shared/money";
import { formatDayMonthTime } from "@/lib/format/date";
import { salesErrorText } from "@/lib/sales/errors";
import {
  loadCashControl,
  requestCashControl,
  type CashDayData,
} from "../cash-control-actions";

const states: Record<string, { label: string; tone: StatusTone }> = {
  unknown: { label: "Нет подтверждённых данных", tone: "neutral" },
  matched: { label: "Совпадает", tone: "success" },
  tolerated: { label: "В пределах порога", tone: "success" },
  shortage: { label: "Недостача", tone: "danger" },
  overage: { label: "Излишек", tone: "warning" },
};
const rub = (cents: number | null) => (cents === null ? null : cents / 100);

/** Контроль кассы: расчётный и заявленный остаток при открытии и закрытии. */
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
        const d = unwrapAction(await loadCashControl(venueId, date));
        if (live) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (live)
          setError(
            salesErrorText(
              e instanceof Error ? e.message : null,
              "Не удалось загрузить контроль кассы",
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
      unwrapAction(await requestCashControl(venueId, date));
      setData(unwrapAction(await loadCashControl(venueId, date)));
      toast.success("Проверка кассы запущена");
    } catch (e) {
      toast.error(
        salesErrorText(
          e instanceof Error ? e.message : null,
          "Не удалось запустить проверку",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  if (!data && !error) return null;
  const jobError = salesErrorText(data?.job?.error);
  return (
    <DrawerSection
      title="Контроль кассы"
      description="Расчётный и указанный кассиром остаток при открытии и закрытии"
      actions={
        data?.canManage ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={pending || busy}
            onClick={() => void request()}
          >
            <RefreshCw
              className={
                pending || busy
                  ? "size-4 animate-spin motion-reduce:animate-none"
                  : "size-4"
              }
            />
            {pending ? "Проверяем…" : "Проверить кассу"}
          </Button>
        ) : undefined
      }
    >
      {(error || jobError || data?.problem) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? jobError ?? data?.problem}
        </p>
      )}
      {pending && (
        <p role="status" className="text-xs text-muted-foreground">
          {data?.job?.phase === "verify"
            ? "Повторно проверяем кассовые отчёты"
            : "Загружаем кассовые отчёты"}
        </p>
      )}
      {!data?.checkedAt && !pending && !error && (
        <p className="text-sm text-muted-foreground">
          Кассовые отчёты за этот день ещё не проверены
        </p>
      )}
      {data?.reports.map((report) => (
        <div key={report.id} className="space-y-2">
          <p className="text-sm font-medium">
            {report.terminal} · смена №{report.shiftNumber ?? report.id}
            {report.cashier && report.cashier !== "Не указан" && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {report.cashier}
              </span>
            )}
          </p>
          <ul className="divide-y">
            {data.results
              .filter((r) => r.reportId === report.id)
              .map((row) => {
                const s = states[row.state] ?? states.unknown;
                return (
                  <li key={row.key} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{row.kind === "open" ? "Открытие" : "Закрытие"}</span>
                      <span className="flex items-center gap-2">
                        {row.diff !== null && row.diff !== 0 && (
                          <Money signed value={rub(row.diff)} />
                        )}
                        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <dt>Расчёт</dt>
                        <dd className="mt-0.5 text-sm text-foreground">
                          <Money value={rub(row.expected)} fraction="auto" />
                        </dd>
                      </div>
                      <div>
                        <dt>Указано кассиром</dt>
                        <dd className="mt-0.5 text-sm text-foreground">
                          <Money value={rub(row.declared)} fraction="auto" />
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
          </ul>
          {report.incomplete && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Кассовый отчёт отмечен как неполный
            </p>
          )}
        </div>
      ))}
      {data?.checkedAt && data.reports.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Кассовых смен за этот рабочий день нет
        </p>
      )}
      {data?.checkedAt && (
        <p className="text-xs text-muted-foreground">
          Проверено {formatDayMonthTime(data.checkedAt)} · допустимое
          расхождение {formatThreshold(data.rules.thresholdCents)}
        </p>
      )}
    </DrawerSection>
  );
}

function formatThreshold(cents: number) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(cents / 100))} ₽`;
}
