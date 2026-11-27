import { readOverviewOpen } from "@/lib/ui/overview-pref-server";
import { OVERVIEW_KEYS } from "@/lib/ui/overview-pref";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadAttendanceAttention, loadPayrollOverview } from "@/app/(dashboard)/people/payroll/actions";
import { attentionKey, type AttentionSnapshot } from "@/lib/payroll/attention-snapshot";
import { unwrapAction } from "@/lib/actions/result";
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
  // «Ждут проверки» — в той же волне: уведомление над вкладками есть в первой
  // разметке и не сдвигает страницу, появляясь после загрузки скриптов.
  const [data, overviewOpen, attention] = await Promise.all([
    loadPayrollOverview(month).then(unwrapAction),
    readOverviewOpen(OVERVIEW_KEYS.payroll),
    loadAttendanceAttention([month])
      .then(unwrapAction)
      .then((items): AttentionSnapshot => ({ key: attentionKey([month]), items }))
      .catch(() => undefined),
  ]);
  return (
    <PayrollWorkspace
      key={`${data.venueId}:${month}`}
      data={data}
      initialMonth={month}
      venueName={data.venueName ?? null}
      initialOverviewOpen={overviewOpen}
      initialAttention={attention}
    />
  );
}
