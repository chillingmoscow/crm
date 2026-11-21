import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import {
  getCounterparty,
  getCounterpartyArchiveImpact,
  listCounterpartyGroups,
} from "@/lib/finance/counterparties";
import { loadCounterpartyActivity, operationDay } from "@/lib/finance/activity";
import { listCounterpartyAttachments } from "@/lib/files/attachments";
import { isDadataConfigured } from "@/lib/dadata/client";
import { listAuditEvents } from "@/lib/audit/list";
import { CounterpartyCard, type CounterpartyOperation } from "./_components/counterparty-card";

export const metadata: Metadata = { title: "Контрагент" };

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

/** Сколько последних операций показывает вкладка «Операции». */
const RECENT_OPERATIONS = 20;

type AuditProfile = { id: string; first_name: string | null; last_name: string | null };

export default async function CounterpartyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Права считаем заранее, чтобы кнопки совпадали с RLS, которая сработает
  // на нажатии: у вложений свои права (finance.upload_attachments на
  // загрузку, finance.delete_attachments на удаление).
  const [can, activeAccountId] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
  ]);
  if (!can("finance.view_counterparties")) redirect("/dashboard");
  const canManage = Boolean(can("finance.manage_counterparties"));
  const canViewTransactions = Boolean(can("finance.view_transactions"));
  const canViewAudit = Boolean(can("org.view_audit"));

  const { row, error } = await getCounterparty(id);
  if (error || !row) redirect("/finance/counterparties");

  const [
    { data: isOwner },
    { rows: groups },
    { rows: attachmentRows },
    archiveImpact,
    activity,
    recent,
    auditResult,
  ] = await Promise.all([
    // Архив, возврат и удаление проверяют владельца на сервере — им же гейтим.
    activeAccountId
      ? supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
      : Promise.resolve({ data: false }),
    listCounterpartyGroups(),
    listCounterpartyAttachments(id),
    getCounterpartyArchiveImpact(id),
    canViewTransactions ? loadCounterpartyActivity() : Promise.resolve(null),
    canViewTransactions
      ? supabase
          .from("transactions")
          .select("id, date, type, amount, description, category_id, bank_account_id")
          .eq("counterparty_id", id)
          .is("deleted_at", null)
          .in("type", ["income", "expense"])
          .order("date", { ascending: false })
          .limit(RECENT_OPERATIONS)
      : Promise.resolve({ data: [] as never[] }),
    canViewAudit
      ? listAuditEvents({ entityType: "counterparty", entityId: id })
      : Promise.resolve({ events: [], hasMore: false, error: null }),
  ]);

  // Подписи операций: статьи и счета одним запросом каждые.
  const recentRows = recent.data ?? [];
  const categoryIds = [...new Set(recentRows.map((tx) => tx.category_id).filter((v): v is string => Boolean(v)))];
  const accountIds = [...new Set(recentRows.map((tx) => tx.bank_account_id))];
  const [{ data: categories }, { data: accounts }] = await Promise.all([
    categoryIds.length
      ? supabase.from("finance_categories").select("id, name").in("id", categoryIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    accountIds.length
      ? supabase.from("bank_accounts").select("id, name").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const operations: CounterpartyOperation[] = recentRows.map((tx) => ({
    id: tx.id,
    date: operationDay(tx.date) ?? tx.date,
    type: tx.type as "income" | "expense",
    amount: Number(tx.amount),
    description: tx.description,
    categoryName: tx.category_id ? categoryName.get(tx.category_id) ?? null : null,
    accountName: accountName.get(tx.bank_account_id) ?? null,
  }));

  // Вложения — в вид общего AttachmentUploader. Подпись типа документа
  // собирается здесь, чтобы клиент не нёс словарь типов.
  const attachments = attachmentRows.map((att) => ({
    fileId:     att.file.id,
    name:       att.file.name,
    mime_type:  att.file.mime_type,
    size_bytes: att.file.size_bytes,
    document_type_label:
      [DOC_TYPE_LABELS[att.document_type] ?? att.document_type, att.document_number, att.document_date]
        .filter(Boolean)
        .join(" · ") || null,
  }));

  // Кто создал и менял — для «О контрагенте» в верхней панели.
  const auditIds = [row.created_by, row.updated_by].filter((v): v is string => Boolean(v));
  const { data: profiles } = auditIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name").in("id", auditIds)
    : { data: [] as AuditProfile[] };
  const profileName = (uid: string | null | undefined) => {
    const p = (profiles as AuditProfile[] | null)?.find((x) => x.id === uid);
    if (!p) return null;
    const first = (p.first_name ?? "").trim();
    const last = (p.last_name ?? "").trim();
    if (!first && !last) return null;
    return last ? `${first} ${last.charAt(0)}.`.trim() : first;
  };

  const stats = activity?.[id];
  return (
    <CounterpartyCard
      row={row}
      groups={groups.map((group) => ({ id: group.id, name: group.name }))}
      attachments={attachments}
      operations={operations}
      activity={
        activity
          ? {
              operations: stats?.operations ?? 0,
              lastDate: stats?.lastDate ?? null,
              incomeTotal: stats?.incomeTotal ?? 0,
              expenseTotal: stats?.expenseTotal ?? 0,
            }
          : null
      }
      canManage={canManage}
      canUploadAttachments={Boolean(can("finance.upload_attachments"))}
      canDeleteAttachments={Boolean(can("finance.delete_attachments"))}
      canViewTransactions={canViewTransactions}
      canViewAudit={canViewAudit}
      isOwner={Boolean(isOwner)}
      canHardDelete={Boolean(isOwner) && Boolean(can("finance.delete_counterparty"))}
      archiveImpact={archiveImpact}
      dadataEnabled={isDadataConfigured()}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
      createdByName={profileName(row.created_by)}
      updatedByName={profileName(row.updated_by)}
    />
  );
}
