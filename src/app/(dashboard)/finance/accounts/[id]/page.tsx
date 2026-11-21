import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { listAccountVenues, listLegalEntities } from "@/lib/org/legal-entities";
import {
  getBankAccount,
  getBankAccountArchiveImpact,
  listBankAccountGroups,
} from "@/lib/finance/bank-accounts";
import { listAuditEvents } from "@/lib/audit/list";
import {
  getReconciliationTimezone,
  listBankAccountReconciliations,
} from "@/lib/finance/bank-reconciliations";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import { BankAccountDetail } from "./_components/bank-account-detail";

export const metadata: Metadata = { title: "Счёт" };

type AuditProfile = { id: string; first_name: string | null; last_name: string | null };

export default async function BankAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [can, activeAccountId, supabase] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
    createClient(),
  ]);
  if (!can("finance.view_bank_accounts")) redirect("/dashboard");
  const canManage = Boolean(can("finance.manage_bank_accounts"));
  const canViewAudit = Boolean(can("org.view_audit"));
  // Сверка раскрывает остаток на любую дату — то есть обороты: только тем,
  // кто видит операции (так же гейтит база, миграция 374).
  const canViewTransactions = Boolean(can("finance.view_transactions"));

  const { row, error } = await getBankAccount(id);
  if (error || !row) redirect("/finance/accounts");

  const [
    { rows: legalEntities },
    { rows: venues },
    { rows: groups },
    amountRoundingScale,
    archiveImpact,
    { data: isOwner },
    auditResult,
    reconciliations,
    timezone,
  ] = await Promise.all([
    listLegalEntities(),
    listAccountVenues({ liveOnly: true }),
    listBankAccountGroups(),
    getActiveAccountAmountRoundingScale(),
    getBankAccountArchiveImpact(id),
    // Архив, возврат и удаление проверяют владельца на сервере
    // (assertBankAccountOwner) — гейтим ими же, а не canManage.
    activeAccountId
      ? supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
      : Promise.resolve({ data: false }),
    canViewAudit
      ? listAuditEvents({ entityType: "bank_account", entityId: id })
      : Promise.resolve({ events: [], hasMore: false, error: null }),
    canViewTransactions
      ? listBankAccountReconciliations(id)
      : Promise.resolve({ rows: [], error: null }),
    getReconciliationTimezone(),
  ]);

  // Кто создал и менял — для «О счёте» в верхней панели.
  const auditIds = [row.created_by, row.updated_by].filter((v): v is string => !!v);
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

  return (
    <BankAccountDetail
      row={row}
      legalEntities={legalEntities.map((le) => ({ id: le.id, name: le.name, short_name: le.short_name }))}
      venues={venues.map((v) => ({ id: v.id, name: v.name }))}
      groups={groups}
      canManage={canManage}
      canViewTransactions={canViewTransactions}
      isOwner={Boolean(isOwner)}
      canHardDelete={Boolean(can("finance.delete_bank_account"))}
      canViewAudit={canViewAudit}
      archiveImpact={archiveImpact}
      amountRoundingScale={amountRoundingScale}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
      createdByName={profileName(row.created_by)}
      updatedByName={profileName(row.updated_by)}
      reconciliations={reconciliations.rows}
      reconciliationsError={reconciliations.error}
      timezone={timezone}
    />
  );
}
