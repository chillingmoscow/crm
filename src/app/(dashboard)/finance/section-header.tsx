"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function FinanceSectionHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (
    pathname === "/finance/payroll" ||
    pathname?.startsWith("/finance/payroll/")
  )
    return null;
  return <>{children}</>;
}
