"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { WriteoffDeductionStatus } from "@/lib/stock/writeoff-deduction-status";
import { writeoffStamp } from "./writeoff-format";

/** «ноябрь 2026» по первому числу месяца. */
export function writeoffMonthName(month: string): string {
  const d = new Date(`${month.slice(0, 7)}-15T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return month.slice(0, 7);
  const name = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    timeZone: "UTC",
  }).format(d);
  return `${name} ${month.slice(0, 4)}`;
}

/** Где пересчитать месяц: ведомость «Зарплаты» на этом месяце. */
export const payrollMonthHref = (month: string) =>
  `/people/payroll?month=${month.slice(0, 7)}`;

const warningClass =
  "flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between";

/**
 * Удержание по недостаче за выбранный месяц: не посчитано, посчитано или
 * устарело из-за списаний. Устаревший расчёт - встроенное предупреждение со
 * ссылкой на «Зарплату», остальное - одна строка под итогами месяца.
 */
export function WriteoffDeductionLine({
  month,
  status,
  failed,
  timezone,
  canOpenPayroll,
  onRetry,
}: {
  month: string;
  status: WriteoffDeductionStatus | null;
  failed: boolean;
  timezone: string;
  /** Ссылку на «Зарплату» видит только тот, кому она откроется. */
  canOpenPayroll: boolean;
  onRetry: () => void;
}) {
  const name = writeoffMonthName(month);
  const payroll = canOpenPayroll ? (
    <Link href={payrollMonthHref(month)} className="text-brand hover:underline">
      Открыть «Зарплату»
    </Link>
  ) : null;

  if (failed)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Не удалось проверить удержание за {name}.{" "}
        <button
          type="button"
          className="text-brand hover:underline"
          onClick={onRetry}
        >
          Повторить
        </button>
      </p>
    );
  if (!status) return null;

  if (status.state === "stale")
    return (
      <div role="status" className={warningClass}>
        <p>
          Удержание за {name} посчитано{" "}
          {writeoffStamp(status.capturedAt, timezone)}, но разнесение списаний
          с тех пор изменилось.{" "}
          {status.unresolved > 0
            ? "Разнесите оставшиеся акты и пересчитайте месяц в «Зарплате»."
            : "Пересчитайте месяц в «Зарплате»."}
        </p>
        {canOpenPayroll && (
          <Button variant="outline" size="sm" className="shrink-0" asChild>
            <Link href={payrollMonthHref(month)}>Открыть «Зарплату»</Link>
          </Button>
        )}
      </div>
    );

  return (
    <p role="status" className="text-sm text-muted-foreground">
      {status.state === "posted" ? (
        <>
          Удержание за {name} посчитано{" "}
          {writeoffStamp(status.capturedAt, timezone)}
        </>
      ) : status.reversedAt ? (
        <>
          Удержание за {name} не посчитано: расчёт сторнирован{" "}
          {writeoffStamp(status.reversedAt, timezone)}
        </>
      ) : (
        <>Удержание за {name} не посчитано</>
      )}
      {payroll && <> · {payroll}</>}
    </p>
  );
}
