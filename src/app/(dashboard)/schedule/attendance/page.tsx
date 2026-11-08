import { redirect } from "next/navigation";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const query = new URLSearchParams({ tab: "attendance" });
  if (month) query.set("month", month.slice(0, 7));
  redirect(`/people/payroll?${query}`);
}
