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
import { CERTIFICATE_ALERT_DAYS } from "@/lib/finance/certificates";
import { todayIso } from "@/lib/finance/certificates-actions";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { asLooseDb } from "@/lib/supabase/loose";
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
  // Сертификаты, которые истекают в ближайшие 30 дней или просрочены, — по
  // контрагентам: пометка в строке и фильтр.
  const today = await todayIso();
  const alertLimit = new Date(Date.parse(`${today}T00:00:00Z`) + CERTIFICATE_ALERT_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [{ rows }, { rows: groups }, activity, alertRows] = await Promise.all([
    listCounterparties({ include_deleted: Boolean(isOwner) }),
    listCounterpartyGroups(),
    canViewTransactions ? loadCounterpartyActivity(period) : Promise.resolve(null),
    fetchAllRows<{ id: string; counterparty_id: string; valid_until: string }>(() =>
      asLooseDb(supabase)
        .from<{ id: string; counterparty_id: string; valid_until: string }[]>("counterparty_certificates")
        .select("id, counterparty_id, valid_until")
        .lte("valid_until", alertLimit),
    ).catch(() => []),
  ]);
  const certificateAlert = new Map<string, "expired" | "expiring">();
  for (const cert of alertRows) {
    const tone = cert.valid_until < today ? "expired" : "expiring";
    if (certificateAlert.get(cert.counterparty_id) !== "expired") certificateAlert.set(cert.counterparty_id, tone);
  }

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
      certificateAlert: certificateAlert.get(row.id) ?? null,
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
