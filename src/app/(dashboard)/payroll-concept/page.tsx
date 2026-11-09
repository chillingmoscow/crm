import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadPayrollOverview } from "@/app/(dashboard)/people/payroll/actions";
import { validDate } from "@/lib/sales/time";
import { PayrollConcept } from "@/app/payroll-concept/payroll-concept";

export const metadata: Metadata = { title: "Зарплата — Sheerly" };

export default async function PayrollConceptPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>;
}) {
  const query = await searchParams;
  const month =
    query.month &&
    /^\d{4}-\d{2}$/.test(query.month) &&
    validDate(`${query.month}-01`)
      ? query.month
      : new Date()
          .toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" })
          .slice(0, 7);
  if (query.tab === "attendance") redirect(`/schedule?date=${month}-01`);
  const data = await loadPayrollOverview();
  return (
    <PayrollConcept
      key={`${data.venueId}:${month}`}
      data={data}
      initialMonth={month}
    />
  );
}
