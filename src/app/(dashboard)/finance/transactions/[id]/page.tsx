import { redirect } from "next/navigation";

// Transaction detail is now shown via the edit drawer on the list page.
// Permalink redirect — historical share links keep working.
export default async function TransactionDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  redirect("/finance/transactions");
}
