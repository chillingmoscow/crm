"use client";
import { unwrapAction } from "@/lib/actions/result";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Money } from "@/components/shared/money";
import { formatDayMonthTime } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { salesErrorText } from "@/lib/sales/errors";
import {
  loadSettlementPanel,
  requestSettlement,
  type SettlementPanelData,
} from "../settlement-actions";
import { SectionRowsSkeleton } from "../../_components/section-skeleton";

const states: Record<string, { label: string; tone: StatusTone }> = {
  matched: { label: "Совпадает", tone: "success" },
  changed: { label: "Сумма или реквизиты отличаются", tone: "warning" },
  review: { label: "Нужна проверка", tone: "warning" },
  missing: { label: "Нет операции в Sheerly", tone: "warning" },
  cancelled: { label: "Отменено вручную", tone: "neutral" },
};

/** Поступления по счетам за день: сверка с финансовыми операциями. */
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
        .then(unwrapAction)
        .then((d) => {
          if (live) {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => {
          if (live)
            setError(
              salesErrorText(
                e instanceof Error ? e.message : null,
                "Не удалось загрузить поступления",
              ),
            );
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
      unwrapAction(await requestSettlement(venueId, date));
      setData(unwrapAction(await loadSettlementPanel(venueId, date)));
      toast.success("Сверка поступлений запущена");
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
        title="Поступления по счетам"
        description="Сверка поступлений с финансовыми операциями"
      >
        <SectionRowsSkeleton label="Загружаем поступления по счетам" />
      </DrawerSection>
    );
  const jobError = salesErrorText(data?.job?.error);
  return (
    <DrawerSection
      title="Поступления по счетам"
      description="Сверка поступлений с финансовыми операциями"
      actions={
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={busy || running || !data}
          onClick={() => void request()}
        >
          <RefreshCw
            className={
              busy || running
                ? "size-4 animate-spin motion-reduce:animate-none"
                : "size-4"
            }
          />
          {running ? "Сверяем…" : "Сверить"}
        </Button>
      }
    >
      {(error || jobError || data?.problem) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? jobError ?? data?.problem}
        </p>
      )}
      {running && (
        <p role="status" className="text-xs text-muted-foreground">
          {data?.job?.phase === "verify"
            ? "Проверяем полноту списка"
            : data?.job?.phase === "orders"
              ? "Загружаем список чеков"
              : `${data?.job?.pass === 2 ? "Повторная проверка" : "Проверяем чеки"}: ${Math.min(data?.job?.cursor ?? 0, data?.job?.total ?? 0)} из ${data?.job?.total ?? 0}`}
          . Сохранённый результат останется до завершения
        </p>
      )}
      {data && !data.configured && (
        <p className="text-sm text-muted-foreground">
          Чтобы сверять поступления, выберите счета, статьи и комиссии в{" "}
          <Link
            className="text-brand hover:underline"
            href={`/sales/settings?venue=${venueId}`}
          >
            настройках заведения
          </Link>
        </p>
      )}
      {!!data?.rows.length && (
        <ul className="divide-y">
          {data.rows.map((r) => {
            const s = states[r.state] ?? states.review;
            return (
              <li
                key={r.key}
                className="flex items-start justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0 space-y-1">
                  <p className="break-words">{r.bank}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {r.label}
                  </p>
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                </div>
                <Money className="shrink-0 font-medium" value={r.amount} />
              </li>
            );
          })}
        </ul>
      )}
      {!!data?.extraCount && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Лишних операций для проверки: {data.extraCount}
        </p>
      )}
      {!!data?.excludedAmount && (
        <p className="text-xs text-muted-foreground">
          Бонусы и оплата без поступления:{" "}
          <Money value={data.excludedAmount} />
        </p>
      )}
      {data?.checkedAt && (
        <p className="text-xs text-muted-foreground">
          {countRu(data.receipts, "чек", "чека", "чеков")} · проверено{" "}
          {formatDayMonthTime(data.checkedAt)}
          {data.version && !data.problem && data.configured && data.ready
            ? " · расхождений нет"
            : ""}
        </p>
      )}
    </DrawerSection>
  );
}
