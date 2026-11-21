"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Шапка раздела «Финансы» с выбором юрлица. Не показывается там, где юрлицо
 * ни на что не влияет или выбирается на самой странице: зарплата живёт в своих
 * рамках, у счетов свой фильтр, статьи и контрагенты общие на весь аккаунт.
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
  // хлебные крошки; второй заголовок «Финансы» над ними лишний. Юрлицо
  // «Счета и кассы» выбирают фильтром в строке условий; статьи и контрагенты
  // общие на аккаунт и от юрлица не зависят.
  if (WITHOUT_HEADER.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null;
  return <>{children}</>;
}
