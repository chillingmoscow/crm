"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Шапка раздела «Финансы» с выбором юрлица. Не показывается там, где юрлицо
 * ни на что не влияет или выбирается на самой странице: на дашборде оно —
 * чип в ряду условий, зарплата живёт в своих рамках, у счетов свой фильтр,
 * статьи и контрагенты общие на весь аккаунт.
 */
const WITHOUT_HEADER = [
  "/finance/payroll",
  "/finance/accounts",
  "/finance/categories",
  "/finance/counterparties",
];

export function FinanceSectionHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  // Страницы, приведённые к эталону (DS «Page header»), рисуют свою шапку и
  // хлебные крошки; второй заголовок «Финансы» над ними лишний. Дашборд —
  // точным совпадением: префикс «/finance/» спрятал бы шапку везде.
  if (
    pathname === "/finance" ||
    WITHOUT_HEADER.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  )
    return null;
  return <>{children}</>;
}
