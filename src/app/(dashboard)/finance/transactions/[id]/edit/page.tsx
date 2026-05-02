import { redirect } from "next/navigation";

// Edit form moved into the inline drawer on the list page. Permalink
// redirect for historical bookmarks.
export default async function EditTransactionRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  redirect("/finance/transactions");
}
