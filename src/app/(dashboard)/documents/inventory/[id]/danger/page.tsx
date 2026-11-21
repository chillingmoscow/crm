import { notFound, redirect } from "next/navigation";

import {
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { getDeleteLockReason } from "@/lib/inventory/act-status";

import { getCachedInventoryDocumentBasics } from "../layout";
import { DangerZone } from "./_components/danger-zone";

export default async function InventoryDocumentDangerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, accountId, can] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
  ]);
  const canManage = can("inventory.manage_documents");

  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");
  if (!canManage) redirect(`/documents/inventory/${id}`);

  const document = await getCachedInventoryDocumentBasics(id, accountId as string);
  if (!document) notFound();

  // Удалить уже нельзя (проведён, итоги зафиксированы) — вкладки нет и в
  // шапке; прямой заход по адресу возвращает на форму акта.
  const deleteLockReason = getDeleteLockReason({
    status: String(document.status),
    resultsSnapshotAt: document.results_snapshot_at,
  });
  if (deleteLockReason) redirect(`/documents/inventory/${id}/overview`);

  return <DangerZone documentId={document.id} documentNumber={document.document_number} />;
}
