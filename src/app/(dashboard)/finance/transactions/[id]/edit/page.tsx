import { redirect } from "next/navigation";

// Правка — в панели на странице списка. Старые ссылки открывают операцию там.
export default async function EditTransactionRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/finance/transactions?id=${encodeURIComponent(id)}`);
}
