import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { loadPayrollRules } from "@/app/(dashboard)/people/payroll/actions";
import { unwrapAction } from "@/lib/actions/result";
import { PayrollSettings } from "@/app/(dashboard)/people/payroll/_components/payroll-settings";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table";

export const metadata: Metadata = { title: "Условия оплаты" };

/**
 * Условия оплаты активного заведения отдельной страницей — сюда ведёт
 * шестерёнка «Зарплаты» и старый адрес /people/automations. Та же форма
 * стоит во вкладке «Оплата труда» карточки заведения.
 */
export default async function PayRulesPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const [{ venueId }, data] = await Promise.all([params, loadPayrollRules().then(unwrapAction)]);
  if (data.venueId !== venueId) redirect("/people/payroll");
  return (
    <ProfilePageFrame>
      <Breadcrumbs
        items={[
          { label: "Люди" },
          { label: "Зарплата", href: "/people/payroll" },
          { label: "Условия оплаты" },
        ]}
      />
      <TablePageHeader title="Условия оплаты" />
      <PayrollSettings venueId={venueId} />
    </ProfilePageFrame>
  );
}
