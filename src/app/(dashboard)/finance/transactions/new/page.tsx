import { redirect } from "next/navigation";

// Create-transaction is now an inline drawer on /finance/transactions —
// see _components/transaction-form-sheet.tsx. This route stays as a
// redirect so deep-linked bookmarks and external links don't 404.
export default function NewTransactionRedirect() {
  redirect("/finance/transactions");
}
