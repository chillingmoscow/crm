"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCheck, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resolvePayoutAlert } from "@/lib/finance/payout-inbox";
import type { PayoutAlertItem } from "@/lib/finance/payout-inbox-data";

export type PayoutAlertResolution = { kind: "resolved" } | { kind: "gone" };

const NETWORK_ERROR = "Нет связи с сервером. Проверьте соединение и повторите";

const KIND_LABEL: Record<PayoutAlertItem["kind"], string> = {
  reconcile: "Сверка с кассой",
  short: "Выдача по плану",
  failed: "Выдача по плану",
  message: "Сообщение менеджерам",
  transfer: "Выплата переводом",
  carry: "Перенос остатка",
  kpi: "KPI старших",
  kpi_plan: "План продаж",
};

/**
 * Карточка выплат зарплаты в «На разбор» (план выплат, этап 3): что
 * случилось, по кому и что сделать. Решение одно — «Всё верно» (закрыть);
 * исправляют существующими действиями в «Зарплате», куда ведёт ссылка.
 * Карточки сверки, переводов и переноса закрываются и сами, когда причина
 * уходит.
 */
export function PayoutAlertCard({ item, canResolve, onResolved, today }: {
  item: PayoutAlertItem;
  /** Право на выплаты зарплаты в заведении. */
  canResolve: boolean;
  onResolved: (result: PayoutAlertResolution) => void;
  /** Сегодня `YYYY-MM-DD` в поясе аккаунта. */
  today: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // У карточек KPI дата — месяц итогов (1-е число), а не день события.
  const kpi = item.kind === "kpi" || item.kind === "kpi_plan";
  const date = kpi ? item.created_at.slice(0, 10) : item.business_date ?? item.created_at.slice(0, 10);

  const resolve = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await resolvePayoutAlert(item.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResolved(result.data.gone ? { kind: "gone" } : { kind: "resolved" });
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const copy = item.copy_text;
  // Сверка, перенос и переводы исправляются в ведомости, выдача и сообщение — в плане выплат.
  const toSheet = item.kind === "transfer" || item.kind === "carry" || item.kind === "reconcile";
  return (
    <section aria-label={item.title} className="min-w-0 max-w-[720px] space-y-6 rounded-lg border bg-card p-4 sm:p-6">
      <div className="min-w-0 space-y-1">
        <h2 className="break-words text-xl font-semibold tracking-normal">{item.title}</h2>
        <p className="text-[13px] text-muted-foreground">
          Зарплата · {KIND_LABEL[item.kind]} · {formatDay(date, today)}
        </p>
      </div>

      {item.lines.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {item.lines.map((line, i) => (
            <li key={i} className={i === item.lines.length - 1 && item.lines.length > 1 ? "pt-1 text-muted-foreground" : undefined}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {copy ? (
        <div className="space-y-2">
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm">{copy}</pre>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard.writeText(copy).then(
                () => toast.success("Скопировано"),
                () => toast.error("Не удалось скопировать"),
              )
            }
          >
            <Copy className="size-4" />
            Скопировать
          </Button>
        </div>
      ) : null}

      {!canResolve ? (
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Разбирать карточки выплат может сотрудник с правом на выплаты зарплаты
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canResolve ? (
          <Button onClick={() => void resolve()} disabled={busy} className="min-w-32">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
            {busy ? "Закрываем…" : "Всё верно"}
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={kpi ? `/people/payroll?tab=kpi&month=${(item.business_date ?? item.created_at).slice(0, 7)}` : toSheet ? "/people/payroll" : "/people/payroll?tab=plan"}>
            {kpi ? "Открыть KPI" : toSheet ? "Открыть зарплату" : "Открыть план выплат"}
          </Link>
        </Button>
      </div>
    </section>
  );
}

/** «05.12»; год дописывается, только если он не текущий. */
function formatDay(day: string, today: string): string {
  const [y, m, d] = day.split("-");
  return y === today.slice(0, 4) ? `${d}.${m}` : `${d}.${m}.${y}`;
}
