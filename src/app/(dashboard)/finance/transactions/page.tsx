import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isDadataConfigured } from "@/lib/dadata/client";

import {
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { listAccountVenues, listLegalEntities } from "@/lib/org/legal-entities";
import { createClient } from "@/lib/supabase/server";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties } from "@/lib/finance/counterparties";
import { getTransaction, queryTransactions } from "@/lib/finance/transactions";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import { parseTransactionQuery } from "@/lib/finance/transaction-query";
import {
  getActiveAccountAmountRoundingScale,
  getActiveAccountTimezone,
} from "@/lib/settings/account";

import { TransactionsPage } from "./_components/transactions-page";

export const metadata: Metadata = { title: "Транзакции" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * /finance/transactions.
 *
 * Адрес — источник условий списка: фильтры, поиск, сортировка, страница,
 * режим «Удалённые» (разбор — `parseTransactionQuery`). Строки, итоги и
 * счётчики приходят одним вызовом `finance_transactions_page` (миграция 371).
 *
 * Права:
 * - finance.view_transactions — вход на страницу;
 * - finance.create_transaction — «Добавить операцию», копирование;
 * - finance.update_transaction (свои) / update_any_transaction (все) — правка;
 * - finance.delete_transaction — удаление, восстановление, «Удалённые»;
 * - finance.export — выгрузка CSV;
 * - finance.manage_* — создание счёта, статьи, контрагента прямо из формы;
 * - finance.view/upload/delete_attachments — файлы операции;
 * - finance.view_all_venues — без него видны операции только активного
 *   заведения, поэтому и выбрать в форме можно только его.
 */
export default async function TransactionsServerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const can = await getCachedPermissionChecker();
  if (!can("finance.view_transactions")) redirect("/dashboard");
  const user = await getCachedUser();

  const permissions = {
    create: !!can("finance.create_transaction"),
    updateOwn: !!can("finance.update_transaction"),
    updateAny: !!can("finance.update_any_transaction"),
    delete: !!can("finance.delete_transaction"),
    export: !!can("finance.export"),
    manageBankAccounts: !!can("finance.manage_bank_accounts"),
    manageCategories: !!can("finance.manage_categories"),
    manageCounterparties: !!can("finance.manage_counterparties"),
    viewAttachments: !!can("finance.view_attachments"),
    uploadAttachments: !!can("finance.upload_attachments"),
    deleteAttachments: !!can("finance.delete_attachments"),
    viewAllVenues: !!can("finance.view_all_venues"),
    viewAllLegalEntities: !!can("finance.view_all_legal_entities"),
  };

  const query = parseTransactionQuery(
    (key) => {
      const value = sp[key];
      return Array.isArray(value) ? value[0] : value;
    },
    { allowDeleted: permissions.delete },
  );

  // Активное юрлицо раздела «Финансы» (cookie) — мягкое условие по
  // умолчанию; ?legal_entity_id в адресе его перекрывает.
  const [storedLegalEntityId, { rows: legalEntities }] = await Promise.all([
    getActiveFinanceLegalEntityId(),
    listLegalEntities(),
  ]);
  // Устаревшее значение (юрлицо удалили, сменился аккаунт) не применяем:
  // иначе список был бы пуст без видимой причины и без кнопки сброса.
  // Без права на все юрлица список ограничен юрлицом заведения на уровне
  // базы: выбор другого (здесь или в шапке раздела) дал бы пустой список.
  const cookieLegalEntityId =
    permissions.viewAllLegalEntities &&
    legalEntities.some((le) => le.id === storedLegalEntityId)
      ? storedLegalEntityId
      : null;
  const effectiveFilters = {
    ...query.filters,
    legal_entity_id: permissions.viewAllLegalEntities
      ? (query.filters.legal_entity_id ?? cookieLegalEntityId ?? undefined)
      : undefined,
  };

  const [
    firstResult,
    { rows: bankAccounts },
    { rows: categories },
    { rows: counterparties },
    amountRoundingScale,
    { rows: venues },
    activeVenueId,
    timeZone,
  ] = await Promise.all([
    queryTransactions({
      filters: effectiveFilters,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    }),
    // Архивные — для подписей в старых строках; в формах и фильтрах
    // предлагаются только действующие.
    listBankAccounts({ include_deleted: true }),
    listFinanceCategories({ include_archived: true }),
    listCounterparties({ include_deleted: true }),
    getActiveAccountAmountRoundingScale(),
    listAccountVenues({ liveOnly: true }),
    getActiveVenueId(),
    getActiveAccountTimezone(),
  ]);

  // ?page=999 или страница, опустевшая после удаления, — показываем
  // последнюю существующую, а не пустую таблицу с «Операций пока нет».
  const totalPages = Math.max(1, Math.ceil(firstResult.total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const result =
    page === query.page
      ? firstResult
      : await queryTransactions({
          filters: effectiveFilters,
          sort: query.sort,
          page,
          pageSize: query.pageSize,
        });

  // ?id=<операция> — ссылки из журнала, зарплаты, поставок и дашборда.
  // Операция грузится здесь же, на сервере: запрос из браузера после
  // открытия страницы Next обрывал при любом обновлении оболочки, и панель
  // молча не открывалась. Удалённая тоже приходит — её можно восстановить.
  const linkedParam = typeof sp.id === "string" ? sp.id : null;
  const linkedTransaction =
    linkedParam && /^[0-9a-f-]{36}$/i.test(linkedParam)
      ? (await getTransaction(linkedParam)).row
      : null;

  return (
    <TransactionsPage
      linkedTransaction={linkedTransaction}
      linkedTransactionId={linkedParam}
      result={result}
      query={{ ...query, page }}
      cookieLegalEntityId={cookieLegalEntityId}
      legalEntities={legalEntities}
      bankAccounts={bankAccounts}
      categories={categories}
      counterparties={counterparties}
      venues={venues}
      activeVenueId={activeVenueId}
      permissions={permissions}
      currentUserId={user?.id ?? null}
      amountRoundingScale={amountRoundingScale}
      dadataEnabled={isDadataConfigured()}
      timeZone={timeZone}
    />
  );
}

/** Активное заведение пользователя: без view_all_venues операции видны только его. */
async function getActiveVenueId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_active_venue_id");
  return (data as string | null) ?? null;
}
