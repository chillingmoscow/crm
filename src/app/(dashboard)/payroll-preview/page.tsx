import type { Metadata } from "next";
import { PayrollPreview } from "./payroll-preview";

export const metadata: Metadata = { title: "Макеты оплаты труда · Sheerly" };
export default async function PayrollPreviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <PayrollPreview initialView={view === "employee" ? "employee" : "role"} />;
}
