import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import {
  getBankAccount,
  listBankAccountGroups,
} from "@/lib/finance/bank-accounts";
import { listAuditEvents } from "@/lib/audit/list";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import { BankAccountDetail } from "./_components/bank-account-detail";
import { BankAccountDetailTabs } from "./_components/bank-account-tabs";

const TYPE_LABEL: Record<string, string> = {
  cash:       "Касса",
  checking:   "Расчётный счёт",
  debit_card: "Дебетовая карта",
  fund:       "Денежный фонд",
  safe:       "Сейф",
};

export default async function BankAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: canView }, { data: canManage }, { data: canViewAudit }] =
    await Promise.all([
      supabase.rpc("has_permission", { permission_code: "finance.view_bank_accounts" }),
      supabase.rpc("has_permission", { permission_code: "finance.manage_bank_accounts" }),
      supabase.rpc("has_permission", { permission_code: "org.view_audit" }),
    ]);
  if (!canView) redirect("/dashboard");

  const { row, error } = await getBankAccount(id);
  if (error || !row) redirect("/finance/accounts");

  const [{ rows: legalEntities }, { rows: venues }, { rows: groups }] =
    await Promise.all([
      listLegalEntities(),
      listAccountVenues(),
      listBankAccountGroups(),
    ]);

  const auditResult = canViewAudit
    ? await listAuditEvents({ entityType: "bank_account", entityId: id })
    : { events: [], hasMore: false, error: null };

  const legalEntityName =
    legalEntities.find((le) => le.id === row.legal_entity_id)?.short_name ??
    legalEntities.find((le) => le.id === row.legal_entity_id)?.name ??
    "—";

  return (
    <div className="p-6 md:p-8 w-full max-w-4xl">
      <Link
        href="/finance/accounts"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку счетов
      </Link>

      <h1 className="text-2xl font-semibold mb-1">{row.name}</h1>
      <p className="text-muted-foreground text-sm mb-6">
        {TYPE_LABEL[row.type] ?? row.type}
        {" • "}
        {legalEntityName}
        {row.bank_name ? ` • ${row.bank_name}` : ""}
      </p>

      <BankAccountDetailTabs
        canViewAudit={Boolean(canViewAudit)}
        main={
          <BankAccountDetail
            row={row}
            legalEntities={legalEntities}
            venues={venues}
            groups={groups}
            canManage={!!canManage}
          />
        }
        history={
          <EntityAuditTab
            mode="entity"
            entityType="bank_account"
            entityId={row.id}
            canView={Boolean(canViewAudit)}
            initialEvents={auditResult.events}
            initialHasMore={auditResult.hasMore}
          />
        }
      />
    </div>
  );
}
