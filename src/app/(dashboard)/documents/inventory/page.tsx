import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissions,
  getCachedUser,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import {
  listInventoryDocuments,
  DOCUMENT_STATUSES,
  DOCUMENT_SORT_MODES,
  DEFAULT_SORT,
  type DocumentSortMode,
  isRecountFilter,
  type DocumentStatus,
  type ListDocumentsFilters,
} from "@/lib/inventory/list-documents";

import { DocumentsTable, type StoreOption, type VenueOption } from "./_components/documents-table";
import type { AssigneeOption } from "./_components/assignee-select";

// ─── Types ───────────────────────────────────────────────────────────────────

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
};

type MembershipRow = {
  user_id: string;
  profiles: ProfileRow | ProfileRow[] | null;
};

type AccountOwnerRow = {
  owner_id: string | null;
};

type SearchParams = {
  venue?: string;
  status?: string;
  assigned?: string;
  reviewer?: string;
  store?: string;
  date_preset?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  recount?: string;
  sort?: string;
  page?: string;
  size?: string;
};

const DEFAULT_PAGE_SIZE = 25;
const ALLOWED_PAGE_SIZES = new Set([25, 50, 100]);
const VALID_SORTS = new Set<DocumentSortMode>(DOCUMENT_SORT_MODES);
const VALID_STATUSES = new Set<DocumentStatus>(DOCUMENT_STATUSES);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function staffName(row: MembershipRow): string {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  return name || row.user_id;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseSearchParams(sp: SearchParams) {
  const venue = sp.venue && sp.venue !== "all" ? sp.venue : undefined;
  const statusRaw = parseCsv(sp.status).filter((s): s is DocumentStatus => VALID_STATUSES.has(s as DocumentStatus));
  const status = statusRaw.length > 0 ? statusRaw : undefined;
  const assigned = sp.assigned && sp.assigned !== "any" ? sp.assigned : undefined;
  const reviewer = sp.reviewer && sp.reviewer !== "any" ? sp.reviewer : undefined;
  const storeIds = parseCsv(sp.store);

  // Период — пресет-метка (Сегодня / Текущий месяц / …) + ISO даты,
  // паттерн из finance/transactions: date_preset хранится в URL как
  // строка-лейбл, отдельных серверных «−7 дней» больше нет.
  const date_from = sp.date_from || undefined;
  const date_to = sp.date_to || undefined;
  const date_preset = sp.date_preset || null;

  const q = sp.q?.trim() && sp.q.trim().length >= 2 ? sp.q.trim() : undefined;

  // Значение из адреса проверяем: чужая ссылка с опечаткой не должна молча
  // отфильтровать половину списка — неизвестное считаем как «все акты».
  const recount = isRecountFilter(sp.recount) && sp.recount !== "any" ? sp.recount : undefined;

  const sortKeysRaw = parseCsv(sp.sort).filter(
    (s): s is DocumentSortMode => VALID_SORTS.has(s as DocumentSortMode),
  );
  const sort: DocumentSortMode[] = sortKeysRaw.length > 0 ? sortKeysRaw : DEFAULT_SORT;

  const requestedPage = parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const requestedSize = parseInt(sp.size ?? `${DEFAULT_PAGE_SIZE}`, 10);
  const pageSize = ALLOWED_PAGE_SIZES.has(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE;

  const filters: ListDocumentsFilters = {
    venue,
    status,
    assigned,
    reviewer,
    store: storeIds.length > 0 ? storeIds : undefined,
    date_from,
    date_to,
    q,
    recount,
  };

  return { filters, sort, page, pageSize, datePreset: date_preset };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function InventoryDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // Права — одним списком (list_my_permissions), а не шестью отдельными
  // has_permission. RPC кэширован на весь RSC-рендер, поэтому dashboard-layout
  // и эта страница делят один вызов; пользователь и активный аккаунт — тоже
  // из кэша layout'а.
  //
  // Перф-PR #517 перевёл на этот путь карточку акта и итоги, а список актов
  // обошёл стороной: здесь оставались шесть has_permission, свой
  // get_active_account_id и свой auth.getUser() — девять сетевых вызовов там,
  // где нужно ноль. На self-hosted каждый стоит десятки миллисекунд.
  const [permissions, user, accountId, amountRoundingScale] = await Promise.all([
    getCachedPermissions(),
    getCachedUser(),
    getCachedActiveAccountId(),
    getActiveAccountAmountRoundingScale(),
  ]);
  const can = (code: string) => permissions.includes(code);
  const canView = can("inventory.view_documents");
  const canManage = can("inventory.manage_documents");
  const canFill = can("inventory.fill_assigned_documents");
  const canSync = can("inventory.sync_quickresto");
  const canViewResults = can("inventory.view_results");
  // Доступ к разделу «Сотрудники» → можно делать исполнителя/проверяющего
  // кликабельной ссылкой на страницу сотрудника.
  const canViewStaff = can("people.view_staff");

  if (!accountId || !user) redirect("/login");
  if (!canView && !canFill) redirect("/dashboard");

  const parsed = parseSearchParams(sp);

  // Список актов — через RLS-клиент (security-fix: текущий код фетчил через
  // admin, обходя venue-скоп из миграции 195). См. PR description.
  const result = await listInventoryDocuments({
    filters: parsed.filters,
    sort: parsed.sort,
    page: parsed.page,
    pageSize: parsed.pageSize,
  });

  // venues + stores для фильтров через RLS-клиент. staff — справочник имён
  // (id → ФИО): нужен ВСЕМ зрителям, иначе read-only пользователь видит «—»
  // вместо исполнителя/проверяющего. Но полный список сотрудников аккаунта
  // нужен только тому, кто назначает: остальным отдаём имена ровно тех людей,
  // что уже стоят в видимых актах.
  const referencedStaffIds = Array.from(
    new Set(
      result.rows
        .flatMap((row) => [row.assigned_to, row.reviewer_id])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [{ data: venuesForFilter }, { data: storesForFilter }, staff] = await Promise.all([
    asLooseDb(supabase).from<VenueOption[]>("venues").select("id, name").order("name"),
    asLooseDb(supabase).from<StoreOption[]>("stores").select("id, title").eq("account_id", accountId).order("title"),
    loadStaff(accountId as string, canManage ? undefined : referencedStaffIds),
  ]);

  return (
    <DocumentsTable
      initial={result}
      filtersFromUrl={parsed.filters}
      sortFromUrl={parsed.sort}
      pageFromUrl={parsed.page}
      pageSizeFromUrl={parsed.pageSize}
      datePresetFromUrl={parsed.datePreset}
      venues={(venuesForFilter ?? []) as VenueOption[]}
      stores={(storesForFilter ?? []) as StoreOption[]}
      staff={staff}
      accountId={accountId as string}
      canManage={Boolean(canManage)}
      canSync={Boolean(canSync)}
      canViewResults={Boolean(canViewResults)}
      canViewStaff={Boolean(canViewStaff)}
      amountRoundingScale={amountRoundingScale}
    />
  );
}

// ─── Staff loader ────────────────────────────────────────────────────────────

/**
 * Справочник «id → ФИО» для колонок «Исполнитель» и «Проверяющий».
 *
 * `restrictToIds` — режим для тех, кто назначать не может: отдаём имена ТОЛЬКО
 * тех людей, что уже стоят в видимых актах. Полный список сотрудников аккаунта
 * такому пользователю не нужен, а раньше страница отдавала его целиком —
 * без права people.view_staff и без venue-скоупа, то есть любой, кто дошёл до
 * списка актов, получал кадровый справочник всего аккаунта.
 */
async function loadStaff(
  accountId: string,
  restrictToIds?: string[],
): Promise<AssigneeOption[]> {
  if (restrictToIds && restrictToIds.length === 0) return [];
  const admin = asLooseDb(createAdminClient());

  const [{ data: venuesRaw }, { data: accountRow }] = await Promise.all([
    admin.from<Array<{ id: string }>>("venues").select("id").eq("account_id", accountId),
    admin.from<AccountOwnerRow>("accounts").select("owner_id").eq("id", accountId).maybeSingle(),
  ]);

  const venueIds = (venuesRaw ?? []).map((v) => v.id);

  // Disambiguation NB: user_venue_roles имеет ДВА FK на profiles —
  // user_id_fkey и invited_by_fkey. Голый embed `profiles(...)` PostgREST
  // расценивает как неоднозначный и возвращает PGRST201 → data=null. До этого
  // фикса ошибка молча игнорировалась и в списке оставался ТОЛЬКО владелец
  // (его добавляет блок ниже отдельным запросом) — поэтому невозможно было
  // назначить никого, кроме себя. Указываем FK явно. Ошибку логируем, чтобы
  // следующая такая регрессия не была тихой.
  const { data: memberships, error: membershipsError } =
    venueIds.length > 0
      ? await admin
          .from<MembershipRow[]>("user_venue_roles")
          .select(
            "user_id, profiles!user_venue_roles_user_id_fkey(first_name, last_name)",
          )
          .in("venue_id", venueIds)
          .eq("status", "active")
      : { data: [] as MembershipRow[], error: null };
  if (membershipsError) {
    console.error(
      "[inventory/loadStaff] memberships query failed",
      membershipsError,
    );
  }

  const staffById = new Map<string, AssigneeOption>();
  const allowed = restrictToIds ? new Set(restrictToIds) : null;
  const ownerId = accountRow?.owner_id ?? null;
  if (ownerId && (!allowed || allowed.has(ownerId))) {
    const { data: ownerProfile } = await admin
      .from<ProfileRow>("profiles")
      .select("first_name, last_name")
      .eq("id", ownerId)
      .maybeSingle();
    staffById.set(ownerId, {
      id: ownerId,
      name: staffName({ user_id: ownerId, profiles: ownerProfile ?? null }),
    });
  }

  for (const row of memberships ?? []) {
    if (allowed && !allowed.has(row.user_id)) continue;
    if (!staffById.has(row.user_id)) {
      staffById.set(row.user_id, { id: row.user_id, name: staffName(row) });
    }
  }

  return Array.from(staffById.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
