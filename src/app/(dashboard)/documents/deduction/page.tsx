import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadDeductionReport } from "@/app/(dashboard)/inventory/deduction-report";
import { DeductionReport } from "./_components/deduction-report";

export const dynamic = "force-dynamic";

export default async function DeductionReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  if (!(await getCachedUser())) redirect("/login");
  const { month } = await searchParams;
  const result = await loadDeductionReport(month ?? null);
  if (!result.ok)
    return <div className="p-6 text-sm text-muted-foreground">{result.error}</div>;
  return <DeductionReport key={result.data.month} data={result.data} />;
}
