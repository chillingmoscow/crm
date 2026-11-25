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
import { parsePeriod, periodParam, periodRange } from "@/lib/finance/period";
import { listCounterpartyAttachments } from "@/lib/files/attachments";
import { filePreviewKind } from "@/lib/files/file-name";
import { mediaUrl } from "@/lib/storage/media";
import { isDadataConfigured } from "@/lib/dadata/client";
import { listAuditEvents } from "@/lib/audit/list";
import { CounterpartyCard, type CounterpartyOperation } from "./_components/counterparty-card";
import type { CounterpartyDocument } from "./_components/counterparty-documents";

export const metadata: Metadata = { title: "Контрагент" };

/** Сколько последних операций показывает вкладка «Операции». */
const RECENT_OPERATIONS = 20;

type AuditProfile = { id: string; first_name: string | null; last_name: string | null };

export default async function CounterpartyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Период вкладки «Операции»: тот же `?period=`, что в списке; без него — всё время.
  const period = parsePeriod(query.period);
  const range = periodRange(period);
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
    canViewTransactions ? loadCounterpartyActivity(period) : Promise.resolve(null),
    canViewTransactions
      ? (() => {
          // Границы — как у фильтра «Транзакций»: дата операции — полночь UTC.
          let recentQuery = supabase
            .from("transactions")
            .select("id, date, type, amount, description, category_id, bank_account_id")
            .eq("counterparty_id", id)
            .is("deleted_at", null)
            .in("type", ["income", "expense"]);
          if (range.from) recentQuery = recentQuery.gte("date", range.from);
          if (range.to) recentQuery = recentQuery.lte("date", range.to);
          return recentQuery.order("date", { ascending: false }).limit(RECENT_OPERATIONS);
        })()
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

  // Документы: новые сверху; у картинок — постоянные адреса миниатюры и
  // крупного вида (кэш браузера на месяц, см. lib/storage/media.ts).
  const attachments: CounterpartyDocument[] = attachmentRows
    .map(({ file }) => {
      const isImage = filePreviewKind(file.mime_type) === "image";
      return {
        fileId:     file.id,
        name:       file.name,
        mimeType:   file.mime_type,
        sizeBytes:  file.size_bytes,
        uploadedAt: file.uploaded_at,
        thumbUrl: isImage
          ? mediaUrl("account-attachments", file.storage_path, { transform: { width: 80, height: 80, resize: "cover" } })
          : null,
        imageUrl: isImage
          ? mediaUrl("account-attachments", file.storage_path, { transform: { width: 1600, resize: "contain" } })
          : null,
      };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

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
      period={periodParam(period)}
      today={new Date().toISOString().slice(0, 10)}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
      createdByName={profileName(row.created_by)}
      updatedByName={profileName(row.updated_by)}
    />
  );
}
