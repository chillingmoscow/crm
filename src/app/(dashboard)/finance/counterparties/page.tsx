import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import {
  listCounterparties,
  listCounterpartyGroups,
} from "@/lib/finance/counterparties";
import { loadCounterpartyActivity } from "@/lib/finance/activity";
import { parsePeriod, periodParam } from "@/lib/finance/period";
import { isDadataConfigured } from "@/lib/dadata/client";
import { contactsFromJson } from "@/lib/finance/counterparty-contacts";
import {
  CounterpartiesClient,
  type CounterpartyListRow,
} from "./_components/counterparties-client";

export const metadata: Metadata = { title: "Контрагенты" };

export default async function CounterpartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ archive?: string; create?: string; period?: string }>;
}) {
  const [can, activeAccountId, supabase, params] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
    createClient(),
    searchParams,
  ]);
  if (!can("finance.view_counterparties")) redirect("/dashboard");
  const canManage = Boolean(can("finance.manage_counterparties"));
  const canViewTransactions = Boolean(can("finance.view_transactions"));
  // Период столбцов активности: ?period=2026-11 | 2026-Q4 | 2026, без него — всё время.
  const period = parsePeriod(params.period);

  // Архив, возврат и удаление проверяют владельца на сервере — им же гейтим.
  const { data: isOwner } = activeAccountId
    ? await supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
    : { data: false };

  // Архивные строки RLS отдаёт тем, кто управляет контрагентами, — но
  // показываем архив только владельцу: вернуть или удалить может только он.
  const [{ rows }, { rows: groups }, activity] = await Promise.all([
    listCounterparties({ include_deleted: Boolean(isOwner) }),
    listCounterpartyGroups(),
    canViewTransactions ? loadCounterpartyActivity(period) : Promise.resolve(null),
  ]);

  const list: CounterpartyListRow[] = rows.map((row) => {
    const stats = activity ? activity[row.id] : undefined;
    const contacts = contactsFromJson(row.contacts);
    const first = contacts[0] ?? null;
    return {
      id: row.id,
      name: row.name,
      legalForm: row.legal_form,
      inn: row.inn,
      kpp: row.kpp,
      groupId: row.group_id,
      contactPerson: first?.name ?? null,
      phone: first?.phone ?? null,
      email: first?.email ?? null,
      contactsText: contacts
        .flatMap((c) => [c.name, c.role, c.email, c.telegram ? `@${c.telegram}` : null])
        .filter(Boolean)
        .join(" "),
      contactPhones: contacts.map((c) => c.phone).filter((p): p is string => Boolean(p)),
      isSupplier: row.is_supplier,
      description: row.description,
      archivedAt: row.deleted_at,
      operations: activity ? (stats?.operations ?? 0) : null,
      lastDate: stats?.lastDate ?? null,
      incomeTotal: activity ? (stats?.incomeTotal ?? 0) : null,
      expenseTotal: activity ? (stats?.expenseTotal ?? 0) : null,
    };
  });

  return (
    <CounterpartiesClient
      rows={list}
      groups={groups.map((group) => ({ id: group.id, name: group.name }))}
      canManage={canManage}
      isOwner={Boolean(isOwner)}
      canHardDelete={Boolean(isOwner) && Boolean(can("finance.delete_counterparty"))}
      canViewTransactions={canViewTransactions}
      hasActivity={activity !== null}
      period={periodParam(period)}
      today={new Date().toISOString().slice(0, 10)}
      dadataEnabled={isDadataConfigured()}
      initialArchive={params.archive === "1" && Boolean(isOwner)}
      openCreate={params.create === "1" && canManage}
    />
  );
}
