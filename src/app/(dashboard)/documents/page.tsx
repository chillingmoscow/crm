import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import {
  listInventoryDocuments,
  DOCUMENT_STATUSES,
  DOCUMENT_SORT_MODES,
  type DocumentSortMode,
  type DocumentStatus,
  type ListDocumentsFilters,
} from "@/lib/inventory/list-documents";

import { DocumentsTable, type VenueOption, type StoreOption } from "./_components/documents-table";
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
const VALID_PRESETS = new Set(["all", "7d", "30d", "90d", "custom"]);

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

function expandDatePreset(
  preset: string,
  customFrom: string | undefined,
  customTo: string | undefined,
): { from?: string; to?: string } {
  if (preset === "custom") {
    return { from: customFrom, to: customTo };
  }
  if (preset === "all" || !preset) return {};
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : null;
  if (days == null) return {};
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10) };
}

function parseSearchParams(sp: SearchParams) {
  const venue = sp.venue && sp.venue !== "all" ? sp.venue : undefined;
  const statusRaw = parseCsv(sp.status).filter((s): s is DocumentStatus => VALID_STATUSES.has(s as DocumentStatus));
  const status = statusRaw.length > 0 ? statusRaw : undefined;
  const assigned = sp.assigned && sp.assigned !== "any" ? sp.assigned : undefined;
  const store = parseCsv(sp.store);

  const presetRaw = sp.date_preset && VALID_PRESETS.has(sp.date_preset) ? sp.date_preset : "all";
  const { from: date_from, to: date_to } = expandDatePreset(presetRaw, sp.date_from, sp.date_to);

  const q = sp.q?.trim() && sp.q.trim().length >= 2 ? sp.q.trim() : undefined;

  const sortRaw = sp.sort as DocumentSortMode | undefined;
  const sort = sortRaw && VALID_SORTS.has(sortRaw) ? sortRaw : "inbox";

  const requestedPage = parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const requestedSize = parseInt(sp.size ?? `${DEFAULT_PAGE_SIZE}`, 10);
  const pageSize = ALLOWED_PAGE_SIZES.has(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE;

  const filters: ListDocumentsFilters = { venue, status, assigned, store: store.length ? store : undefined, date_from, date_to, q };

  return { filters, sort, page, pageSize, datePreset: (presetRaw as "all" | "7d" | "30d" | "90d" | "custom") };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function InventoryDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: canView }, { data: canManage }, { data: canFill }, { data: canSync }, { data: accountId }, { data: { user } }, amountRoundingScale] =
    await Promise.all([
      supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
      supabase.rpc("has_permission", { permission_code: "inventory.manage_documents" }),
      supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
      supabase.rpc("has_permission", { permission_code: "inventory.sync_quickresto" }),
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

  // Дальше: venues + stores для фильтров (RLS-клиент даёт только те, что
  // пользователь видит), staff для назначения (admin — поведение не меняем).
  const [{ data: venuesForFilter }, { data: storesForFilter }, staff] = await Promise.all([
    asLooseDb(supabase).from<VenueOption[]>("venues").select("id, name").order("name"),
    asLooseDb(supabase).from<StoreOption[]>("stores").select("id, title").eq("account_id", accountId).order("title"),
    canManage ? loadStaff(accountId as string) : Promise.resolve<AssigneeOption[]>([]),
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
      amountRoundingScale={amountRoundingScale}
    />
  );
}

// ─── Staff loader ────────────────────────────────────────────────────────────

async function loadStaff(accountId: string): Promise<AssigneeOption[]> {
  // Owner + все memberships аккаунта (active) — кому можно назначить акт.
  // Логика идентична предыдущему page.tsx, только вынесена в хелпер.
  const admin = asLooseDb(createAdminClient());

  const [{ data: venuesRaw }, { data: accountRow }] = await Promise.all([
    admin.from<Array<{ id: string }>>("venues").select("id").eq("account_id", accountId),
    admin.from<AccountOwnerRow>("accounts").select("owner_id").eq("id", accountId).maybeSingle(),
  ]);

  const venueIds = (venuesRaw ?? []).map((v) => v.id);

  const { data: memberships } =
    venueIds.length > 0
      ? await admin
          .from<MembershipRow[]>("user_venue_roles")
          .select("user_id, profiles(first_name, last_name)")
          .in("venue_id", venueIds)
          .eq("status", "active")
      : { data: [] as MembershipRow[] };

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
