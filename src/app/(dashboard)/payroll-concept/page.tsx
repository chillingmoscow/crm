import type { Metadata } from "next";
import { loadPayroll } from "@/app/(dashboard)/people/payroll/actions";
import { validDate } from "@/lib/sales/time";
import { PayrollConcept } from "@/app/payroll-concept/payroll-concept";
import { DeductionRecalculate } from "@/app/(dashboard)/inventory/_components/deduction-recalculate";

export const metadata: Metadata = { title: "Зарплата — Sheerly" };

export default async function PayrollConceptPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const query = await searchParams;
  const month =
    query.month &&
    /^\d{4}-\d{2}$/.test(query.month) &&
    validDate(`${query.month}-01`)
      ? query.month
      : new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" }).slice(0, 7);
  const data = await loadPayroll();
  // Ручной пересчёт удержания по недостаче - там, где правят табель и смены: такие
  // правки автопересчёт не запускают. Право проверяет и сам серверный пересчёт.
  const canRecalculate = data.permissions.includes("inventory.post_deductions");
  return (
    <>
      <PayrollConcept data={data} initialMonth={month} />
      {canRecalculate ? (
        <div className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
          <DeductionRecalculate
            venueId={data.venueId}
            today={new Date().toLocaleDateString("sv-SE", { timeZone: data.timezone || "Europe/Moscow" })}
          />
        </div>
      ) : null}
    </>
  );
}
