import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadPayrollOverview } from "@/app/(dashboard)/people/payroll/actions";
import { validDate } from "@/lib/sales/time";
import { PayrollWorkspace } from "@/app/(dashboard)/people/payroll/_components/payroll-workspace";

export const metadata: Metadata = { title: "Зарплата" };

export default async function PayrollPage({
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
  // Название заведения (для шапки выгрузки ведомости) приходит в том же
  // запросе к venues, что и часовой пояс, — без отдельного шага после обзора.
  const data = await loadPayrollOverview();
  return (
    <PayrollWorkspace
      key={`${data.venueId}:${month}`}
      data={data}
      initialMonth={month}
      venueName={data.venueName ?? null}
    />
  );
}
