import { cn } from "@/lib/utils";
import { formatAmount, signedAmountClass } from "@/lib/format/amount";

/**
 * Сумма в рублях по правилам design-system § «Деньги, числа, даты»:
 * целые, знак ₽ отдельным серым символом меньшего кегля, неизвестная сумма —
 * «—» без знака валюты. `signed` — со знаком (+ / типографский −) и цветом
 * через `signedAmountClass`; ноль серый.
 *
 * Для строк (тосты, экспорт, aria-label) — `formatRub`.
 */
export function Money({
  value,
  signed = false,
  fraction = false,
  className,
}: {
  value: number | null | undefined;
  signed?: boolean;
  /**
   * Копейки: `true` — всегда (карточка одной операции); `"auto"` — только
   * если они есть (ставки, рассрочки, остаток к выплате: округление до
   * рубля там искажает сумму). По умолчанию — целые.
   */
  fraction?: boolean | "auto";
  className?: string;
}) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "whitespace-nowrap tabular-nums",
        signed
          ? signedAmountClass(value)
          : value === 0
            ? "text-muted-foreground"
            : undefined,
        className,
      )}
    >
      {sign}
      {formatAmount(Math.abs(value), digits(value, fraction))}
      <span className="ml-0.5 text-[0.85em] font-normal text-muted-foreground">
        ₽
      </span>
    </span>
  );
}

/** Строка суммы для тостов, подписей и экспорта: «1 200 ₽», «−300 ₽», «—». */
export function formatRub(
  value: number | null | undefined,
  {
    signed = false,
    fraction = false,
  }: { signed?: boolean; fraction?: boolean | "auto" } = {},
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : "";
  return `${sign}${formatAmount(Math.abs(value), digits(value, fraction))} ₽`;
}

function digits(value: number, fraction: boolean | "auto"): 0 | 2 {
  if (fraction === "auto")
    return Math.round(Math.abs(value) * 100) % 100 === 0 ? 0 : 2;
  return fraction ? 2 : 0;
}
