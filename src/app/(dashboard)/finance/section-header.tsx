"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Плашка «Финансы» с переключателем юрлица. Страницы, приведённые к эталону
 * списка (хлебные крошки в верхней панели, свой заголовок), её не
 * показывают: второй заголовок над h1 страницы лишний. На «Транзакциях»
 * юрлицо выбирается чипом в ряду условий.
 */
export function FinanceSectionHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (
    pathname === "/finance/payroll" ||
    pathname?.startsWith("/finance/payroll/") ||
    pathname === "/finance/supplies" ||
    pathname === "/finance/transactions"
  )
    return null;
  return <>{children}</>;
}
