import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPayrollRules } from "@/app/(dashboard)/people/payroll/actions";
import { PayrollSettings } from "@/app/(dashboard)/people/payroll/_components/payroll-settings";
import { TablePageHeader } from "@/components/shared/table";
export default async function PayRulesPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const [{ venueId }, data] = await Promise.all([params, loadPayrollRules()]);
  if (data.venueId !== venueId) redirect("/people/payroll");
  return (
    <div className="min-w-0 space-y-6 p-4 md:p-6">
      <TablePageHeader
        title="Условия оплаты"
        actions={
          <Link
            href="/people/payroll"
            className="text-sm text-brand hover:underline"
          >
            К ведомости →
          </Link>
        }
      />
      <PayrollSettings venueId={venueId} />
    </div>
  );
}
