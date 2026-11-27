import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import s from "./metric-strip.module.css";

/**
 * Итоги периода — одна полоса на списке «Зарплаты» и на странице расчёта
 * сотрудника (DS → «Показатели и период»). Число не крупнее 28px, на узком
 * контейнере 2×2 и 20px.
 */
export function MetricStrip({
  label,
  children,
  columns = 4,
  className,
}: {
  /** Подпись области для скринридера: «Итоги за месяц». */
  label: string;
  children: ReactNode;
  /**
   * Сколько показателей в ряд на широком контейнере (по умолчанию 4). Меньше
   * — когда показателей меньше, чтобы справа не оставалась пустая ячейка.
   * На узком контейнере всё равно 2 в ряд (1 — если показатель один).
   */
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  return (
    <section aria-label={label} className={cn(s.wrap, className)}>
      <div
        className={s.strip}
        data-single={columns === 1 ? "true" : undefined}
        style={{ "--metric-columns": columns } as CSSProperties}
      >
        {children}
      </div>
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  icon,
  primary = false,
  onClick,
  href,
  ariaLabel,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Строка под числом: пояснение или причина прочерка (видимым текстом). */
  hint?: ReactNode;
  /** Иконка справа от подписи — у показателей, которые открывают подробности. */
  icon?: ReactNode;
  primary?: boolean;
  onClick?: () => void;
  /** Переход к подробностям другой страницей — вместо `onClick`. */
  href?: string;
  ariaLabel?: string;
}) {
  const body = (
    <>
      <span className={s.label}>
        {label}
        {icon}
      </span>
      <strong className={s.value}>{value}</strong>
      {hint ? <small className={s.hint}>{hint}</small> : null}
    </>
  );
  const className = cn(s.metric, primary && s.primary);
  if (href)
    return (
      <Link href={href} className={className} aria-label={ariaLabel}>
        {body}
      </Link>
    );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-label={ariaLabel}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
