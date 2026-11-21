"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function FinanceSectionHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Страницы, приведённые к эталону (DS «Page header»), рисуют свою шапку и
  // хлебные крошки; второй заголовок «Финансы» над ними лишний. Юрлицо
  // «Счета и кассы» выбирают фильтром в строке условий.
  if (
    pathname === "/finance/payroll" ||
    pathname?.startsWith("/finance/payroll/") ||
    pathname === "/finance/accounts" ||
    pathname?.startsWith("/finance/accounts/")
  )
    return null;
  return <>{children}</>;
}
