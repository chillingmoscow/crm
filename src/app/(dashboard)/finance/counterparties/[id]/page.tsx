import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import {
  getCounterparty,
  listCounterpartyGroups,
  getCounterpartyArchiveImpact,
} from "@/lib/finance/counterparties";
import { listCounterpartyAttachments } from "@/lib/files/attachments";
import { isDadataConfigured } from "@/lib/dadata/client";
import { CounterpartyDetail } from "./_components/counterparty-detail";

const DOC_TYPE_LABELS: Record<string, string> = {
  receipt:          "Чек",
  contract:         "Договор",
  act:              "Акт",
  invoice:          "Счёт",
  waybill:          "Накладная",
  tax_document:     "Налоговый документ",
  registration_doc: "Учредительный",
  other:            "Прочее",
};

export default async function CounterpartyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Permission checks resolved up front so all child gates align with the
  // RLS that actually runs on click. The attachment uploader has its own
  // RLS (finance.upload_attachments for INSERT, finance.delete_attachments
  // for DELETE) — gating the upload button on manage_counterparties alone
  // would let those buttons show and then fail at click.
  const [can, activeAccountId] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
  ]);
  const canView = can("finance.view_counterparties");
  const canManage = can("finance.manage_counterparties");
  const canUploadAttachments = can("finance.upload_attachments");
  const canDeleteAttachments = can("finance.delete_attachments");
  const canHardDelete = can("finance.delete_counterparty");
  if (!canView) redirect("/dashboard");

  // canArchive — owner-check для гейта DangerZone (archive/restore/delete
  // actions требуют owner на сервере независимо от canManage).
  const { data: isOwner } = activeAccountId
    ? await supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
    : { data: false };

  const { row, error } = await getCounterparty(id);
  if (error || !row) redirect("/finance/counterparties");

  const [{ rows: groups }, { rows: attachmentRows }, archiveImpact] = await Promise.all([
    listCounterpartyGroups(),
    listCounterpartyAttachments(id),
    getCounterpartyArchiveImpact(id),
  ]);

  // Map server-side joined rows to the AttachmentRowDisplay shape used
  // by the shared <AttachmentUploader>. The label is rendered here
  // (server) so the client doesn't carry a doc-type → label dictionary.
  const attachments = attachmentRows.map((att) => ({
    fileId:     att.file.id,
    name:       att.file.name,
    mime_type:  att.file.mime_type,
    size_bytes: att.file.size_bytes,
    document_type_label:
      [DOC_TYPE_LABELS[att.document_type] ?? att.document_type, att.document_number, att.document_date]
        .filter(Boolean)
        .join(" • ") || null,
  }));

  return (
    <div className="p-6 md:p-8 w-full max-w-4xl">
      <Link
        href="/finance/counterparties"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку контрагентов
      </Link>

      <h1 className="text-2xl font-semibold mb-1">{row.name}</h1>
      <p className="text-muted-foreground text-sm mb-6">
        {row.inn ? `ИНН ${row.inn}` : "ИНН не указан"}
        {row.kpp ? ` • КПП ${row.kpp}` : ""}
        {row.dadata_synced_at
          ? ` • DaData ${new Date(row.dadata_synced_at).toLocaleDateString("ru-RU")}`
          : ""}
      </p>

      <CounterpartyDetail
        row={row}
        groups={groups}
        attachments={attachments}
        canManage={!!canManage}
        canUploadAttachments={!!canUploadAttachments}
        canDeleteAttachments={!!canDeleteAttachments}
        canArchive={!!isOwner}
        canHardDelete={!!canHardDelete}
        archiveImpact={archiveImpact}
        dadataEnabled={isDadataConfigured()}
      />
    </div>
  );
}
