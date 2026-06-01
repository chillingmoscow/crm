import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import {
  listInventoryDocuments,
  DOCUMENT_STATUSES,
  DOCUMENT_SORT_MODES,
  DEFAULT_SORT,
  type DocumentSortMode,
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

  const [
    { data: canView },
    { data: canManage },
    { data: canFill },
    { data: canSync },
    { data: canViewResults },
    { data: canViewStaff },
    { data: accountId },
    { data: { user } },
    amountRoundingScale,
  ] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.manage_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.sync_quickresto" }),
    supabase.rpc("has_permission", { permission_code: "inventory.view_results" }),
    // Доступ к разделу «Сотрудники» → можно делать исполнителя/проверяющего
    // кликабельной ссылкой на страницу сотрудника.
    supabase.rpc("has_permission", { permission_code: "people.view_staff" }),
    supabase.rpc("get_active_account_id"),
    supabase.auth.getUser(),
    getActiveAccountAmountRoundingScale(),
  ]);

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
  // (id → ФИО) нужен ВСЕМ зрителям, не только тем, кто может назначать:
  // иначе read-only пользователь видит «—» вместо исполнителя/проверяющего,
  // и переход на страницу сотрудника из завершённого акта недоступен.
  const [{ data: venuesForFilter }, { data: storesForFilter }, staff] = await Promise.all([
    asLooseDb(supabase).from<VenueOption[]>("venues").select("id, name").order("name"),
    asLooseDb(supabase).from<StoreOption[]>("stores").select("id, title").eq("account_id", accountId).order("title"),
    loadStaff(accountId as string),
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

async function loadStaff(accountId: string): Promise<AssigneeOption[]> {
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
  const ownerId = accountRow?.owner_id ?? null;
  if (ownerId) {
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
    if (!staffById.has(row.user_id)) {
      staffById.set(row.user_id, { id: row.user_id, name: staffName(row) });
    }
  }

  return Array.from(staffById.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
