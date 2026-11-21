import { redirect } from "next/navigation";

// Операция открывается панелью на странице списка. Старые ссылки
// /finance/transactions/<id> ведут туда же и открывают эту операцию.
export default async function TransactionDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/finance/transactions?id=${encodeURIComponent(id)}`);
}
