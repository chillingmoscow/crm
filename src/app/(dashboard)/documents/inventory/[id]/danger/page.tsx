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

  return (
    <div className="w-full px-4 py-6 md:px-8">
      <DangerZone
        documentId={document.id}
        documentNumber={document.document_number}
        deleteLockReason={getDeleteLockReason({
          status: String(document.status),
          resultsSnapshotAt: document.results_snapshot_at,
        })}
      />
    </div>
  );
}
