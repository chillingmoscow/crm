"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Шапка раздела «Финансы» с выбором юрлица. Не показывается там, где юрлицо
 * ни на что не влияет: зарплата и поставки живут в своих рамках, статьи и
 * контрагенты общие на весь аккаунт.
 */
const WITHOUT_HEADER = ["/finance/payroll", "/finance/supplies", "/finance/categories", "/finance/counterparties"];

export function FinanceSectionHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  if (WITHOUT_HEADER.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null;
  return <>{children}</>;
}
