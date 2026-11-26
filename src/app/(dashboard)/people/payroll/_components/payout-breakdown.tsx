import type { ReactNode } from "react";
import { Money, formatRub } from "@/components/shared/money";
import { countRu } from "@/lib/format/plural";
import { floorStep, type PlannedRow } from "@/lib/payroll/payout-plan";
import { cn } from "@/lib/utils";

type Op = "+" | "−" | "=" | "";

/**
 * Строка расчёта: знак действия в левой колонке, сумма без знака справа —
 * читается как столбик на бумаге. Итог шага — жирным, с линией сверху.
 */
function Line({ op = "", label, hint, value, result }: { op?: Op; label: string; hint?: ReactNode; value: number; result?: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 py-1.5 text-sm",
        result && "mt-1 border-t pt-2.5 font-semibold",
      )}
    >
      <span aria-hidden className="text-center text-muted-foreground">{op}</span>
      <span className="min-w-0">
        {label}
        {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 tabular-nums">
        {op === "−" && <span className="sr-only">минус </span>}
        <Money value={Math.abs(value)} />
      </span>
    </div>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div>{children}</div>
    </section>
  );
}

/**
 * «Как посчитано» в строке плана выплат: три шага вместо сплошного списка —
 * половина месяца, сколько выходит по половине, итог с потолком. Тот же
 * расчёт, что в `planFirstPayout` (Павел, 26.11: «оформи симпатичнее»).
 */
const MONTH_DATIVE = ["январю", "февралю", "марту", "апрелю", "маю", "июню", "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю"];

export function PayoutBreakdown({ b, amount, issued, manual, leftAfter, step, month }: { b: PlannedRow["breakdown"]; amount: number; issued: number; manual: boolean; leftAfter: number | null; step: number; month: string | null }) {
  const byMonth = month ? `по ${MONTH_DATIVE[Number(month.slice(5, 7)) - 1] ?? "месяцу"}` : "за месяц";
  const total = b.carried + b.earned + b.forecast - b.reserve;
  const byHalf = Math.max(0, b.target);
  const cap = Math.max(0, b.ceiling);
  const computed = Math.max(0, floorStep(Math.min(byHalf, cap), step));
  const forecastHint = b.averageShift == null
    ? "мало смен для прогноза"
    : `${countRu(b.forecastShifts, "смена", "смены", "смен")} × ${formatRub(b.averageShift)}`;
  return (
    <div className="space-y-6">
      <Step title="Половина месяца">
        {b.carried !== 0 && (
          <Line op={b.carried < 0 ? "−" : ""} label={b.carried < 0 ? "Переплата прошлого месяца" : "Перенесено из прошлого месяца"} value={b.carried} />
        )}
        <Line
          op={b.carried !== 0 ? "+" : ""}
          label="Начислено за месяц"
          hint={b.pendingFines ? `без штрафов на подтверждении: ${formatRub(b.pendingFines)}` : undefined}
          value={b.earned}
        />
        <Line op="+" label="Прогноз до конца месяца" hint={forecastHint} value={b.forecast} />
        <Line op="−" label="Запас" value={b.reserve} />
        <Line op="=" label="Половина" hint={`${formatRub(total)} пополам`} value={b.half} result />
      </Step>

      <Step title="По половине">
        <Line label="Половина" value={b.half} />
        {b.paid > 0 && <Line op="−" label="Уже выплачено за месяц" value={b.paid} />}
        {b.official > 0 && <Line op="−" label="Официальная часть" hint="выплатит бухгалтерия" value={b.official} />}
        <Line
          op="="
          label="По половине"
          hint={b.target < 0 ? "выходит меньше нуля — по половине не выдаём" : undefined}
          value={byHalf}
          result
        />
      </Step>

      <Step title="Итог">
        <Line label="По половине" value={byHalf} />
        <Line
          label="Можно выдать без переплаты"
          hint={b.official > 0 ? "перенос + начислено − выплаченное − запас − официальная часть" : "перенос + начислено − выплаченное − запас"}
          value={cap}
        />
        <Line
          op="="
          label="К выплате"
          hint={
            <>
              {manual
                ? <>поставлено вручную, по расчёту сейчас — {formatRub(computed)}</>
                : Math.round(computed) !== Math.round(amount)
                  ? <>сумма плана; по расчёту сейчас — {formatRub(computed)}</>
                  : <>меньшее из двух, вниз до {formatRub(step)}</>}
            </>
          }
          value={amount}
          result
        />
        {issued > 0 && <Line label="Уже выдано по плану" value={issued} />}
        {leftAfter !== null && (
          <Line
            label={leftAfter < 0 ? `Переплатим ${byMonth}` : `Будем должны ${byMonth}`}
            hint={`можно выдать без переплаты + запас − к выплате; будущие смены не входят`}
            value={leftAfter}
          />
        )}
      </Step>
    </div>
  );
}
