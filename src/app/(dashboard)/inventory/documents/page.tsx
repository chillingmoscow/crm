import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import { DocumentsClient } from "./_components/documents-client";

type StaffRow = {
  id: string;
  name: string;
};

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
};

type MembershipRow = {
  user_id: string;
  profiles: ProfileRow | ProfileRow[] | null;
};

type InventoryDocumentRow = {
  id: string;
  document_number: string;
  invoice_date: string | null;
  status: string;
  processed: boolean;
  assigned_to: string | null;
  shortfall_sum: number | null;
  surplus_sum: number | null;
  results_has_line_amounts: boolean;
  store_id: string | null;
};

type StoreTitleRow = {
  id: string;
  title: string;
};

type VenueIdRow = {
  id: string;
};

type AccountOwnerRow = {
  owner_id: string | null;
};

function staffName(row: MembershipRow) {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  return name || row.user_id;
}

function isRecentInventoryDocument(row: InventoryDocumentRow) {
  if (!row.invoice_date) return false;
  const invoiceMs = Date.parse(row.invoice_date);
  if (!Number.isFinite(invoiceMs)) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  cutoff.setHours(0, 0, 0, 0);
  return invoiceMs >= cutoff.getTime();
}

export default async function InventoryDocumentsPage() {
  const supabase = await createClient();
  const admin = asLooseDb(createAdminClient());

  const [
    { data: canView },
    { data: canManage },
    { data: canFill },
    { data: canSync },
    { data: accountId },
    {
      data: { user },
    },
    amountRoundingScale,
  ] = await Promise.all([
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

  let docsQuery = admin
    .from<InventoryDocumentRow[]>("inventory_documents")
    .select("id, document_number, invoice_date, status, processed, assigned_to, shortfall_sum, surplus_sum, results_has_line_amounts, store_id")
    .eq("account_id", accountId)
    .order("invoice_date", { ascending: false, nullsFirst: false });
  if (!canView) docsQuery = docsQuery.eq("assigned_to", user.id);
  const { data: documentsRaw } = await docsQuery;
  const documents = (documentsRaw ?? []).filter(isRecentInventoryDocument);

  const documentIds = documents.map((doc) => doc.id);
  const storeIds = documents.map((doc) => doc.store_id).filter((id): id is string => Boolean(id));
  const [{ data: itemsRaw }, { data: storesRaw }, { data: venuesRaw }] = await Promise.all([
    documentIds.length > 0
      ? admin.from<Array<{ document_id: string }>>("inventory_document_items").select("document_id").in("document_id", documentIds)
      : Promise.resolve({ data: [] as Array<{ document_id: string }>, error: null }),
    storeIds.length > 0
      ? admin.from<StoreTitleRow[]>("inventory_stores").select("id, title").in("id", storeIds)
      : Promise.resolve({ data: [] as StoreTitleRow[], error: null }),
    admin.from<VenueIdRow[]>("venues").select("id").eq("account_id", accountId),
  ]);

  const itemCountByDocument = new Map<string, number>();
  for (const item of itemsRaw ?? []) {
    itemCountByDocument.set(item.document_id, (itemCountByDocument.get(item.document_id) ?? 0) + 1);
  }
  const storeTitleById = new Map((storesRaw ?? []).map((store) => [store.id, store.title]));

  const venueIds = (venuesRaw ?? []).map((venue) => venue.id);
  let staff: StaffRow[] = [];
  if (canManage) {
    const [{ data: memberships }, { data: accountRow }] = await Promise.all([
      venueIds.length > 0
        ? admin
            .from<MembershipRow[]>("user_venue_roles")
            .select("user_id, profiles(first_name, last_name)")
            .in("venue_id", venueIds)
            .eq("status", "active")
        : Promise.resolve({ data: [] as MembershipRow[], error: null }),
      admin
        .from<AccountOwnerRow>("accounts")
        .select("owner_id")
        .eq("id", accountId)
        .maybeSingle(),
    ]);

    const staffById = new Map<string, StaffRow>();
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

    staff = Array.from(staffById.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  const rows = documents.map((doc) => ({
    ...doc,
    item_count: itemCountByDocument.get(doc.id) ?? 0,
    store_title: doc.store_id ? storeTitleById.get(doc.store_id) ?? null : null,
  }));

  return (
    <div className="w-full px-4 py-4 md:px-8 md:py-6">
      <DocumentsClient
        documents={rows}
        staff={staff}
        canManage={Boolean(canManage)}
        canSync={Boolean(canSync)}
        amountRoundingScale={amountRoundingScale}
      />
    </div>
  );
}
