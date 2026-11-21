"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Полоса «Финансы» с выбором юрлица над страницами, которые ещё не приведены
 * к эталону. Приведённые страницы рисуют свою шапку (хлебные крошки,
 * заголовок, период) и полосу прячут: на дашборде выбор юрлица — чип в ряду
 * условий.
 */
export function FinanceSectionHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (
    pathname === "/finance" ||
    pathname === "/finance/payroll" ||
    pathname?.startsWith("/finance/payroll/") ||
    pathname === "/finance/supplies"
  )
    return null;
  return <>{children}</>;
}
