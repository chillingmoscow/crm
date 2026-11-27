"use server";

import { createClient, getCachedPermissions } from "@/lib/supabase/server";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { INVENTORY_STATUS_LABEL } from "@/components/shared/inventory-status-badge";
import { STATUSES as CANDIDATE_STATUSES } from "@/lib/candidates/types";
import { formatMoney } from "@/lib/format/amount";
import { formatDateCell } from "@/lib/format/date";
import { mediaUrl } from "@/lib/storage/media";
import type { PaletteGroup, PaletteHit, PaletteSearchResult } from "./types";

/** Сколько находок показываем в одной группе палитры. */
const PER_GROUP = 5;

/**
 * Поиск палитры ⌘K: люди, кандидаты, гости, акты, операции, страницы базы
 * знаний. Каждая группа ищет только при своём праве и читает данные
 * клиентом пользователя (RLS и SECURITY DEFINER-функции сами режут строки
 * и поля), так что палитра не показывает больше, чем сам раздел. Группы
 * ищут параллельно; упавшая группа не роняет остальные.
 */
export async function searchPalette(rawQuery: string): Promise<PaletteSearchResult> {
  const query = String(rawQuery ?? "").trim().slice(0, 80);
  if (query.length < 2) return { hits: [] };
  const perms = new Set(await getCachedPermissions());
  const supabase = await createClient();
  const db = asLooseDb(supabase);

  const sources: Array<[PaletteGroup, boolean, () => Promise<PaletteHit[]>]> = [
    ["staff", perms.has("people.view_staff"), () => searchStaff(db, query, perms)],
    ["candidates", perms.has("people.manage_candidates"), () => searchCandidates(db, query)],
    ["guests", perms.has("crm.view_guests"), () => searchGuests(db, query)],
    [
      "acts",
      ["inventory.view_documents", "inventory.manage_documents", "inventory.fill_assigned_documents"].some(
        (code) => perms.has(code),
      ),
      () => searchActs(db, query, perms),
    ],
    ["transactions", perms.has("finance.view_transactions"), () => searchTransactions(db, query)],
    ["knowledge", perms.has("kb.view_pages"), () => searchKnowledge(db, query)],
  ];

  const results = await Promise.all(
    sources.map(async ([group, allowed, run]) => {
      if (!allowed) return [];
      try {
        return (await run()).slice(0, PER_GROUP);
      } catch (error) {
        console.error(`[palette] ${group}: ${error instanceof Error ? error.message : error}`);
        return [];
      }
    }),
  );
  return { hits: results.flat() };
}

/** Экранирует спецсимволы для `ilike` и выкидывает разделители PostgREST `or`. */
function likeTerm(query: string) {
  return query.replace(/[,()*\\]/g, " ").replace(/[%_]/g, (c) => `\\${c}`).trim();
}

const norm = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е");

async function activeVenue(db: LooseDb): Promise<string | null> {
  const { data, error } = await db.rpc("get_active_venue_id");
  return error || !data ? null : String(data);
}

async function searchStaff(db: LooseDb, query: string, perms: Set<string>): Promise<PaletteHit[]> {
  const venue = await activeVenue(db);
  if (!venue) return [];
  const { data, error } = await db.rpc("get_venue_staff", { p_venue_id: venue });
  if (error) throw new Error(error.message);
  const q = norm(query);
  const detail = perms.has("people.view_staff_details");
  return ((data ?? []) as Array<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    role_name: string | null;
    department_name: string | null;
    avatar_url: string | null;
  }>)
    .map((s) => ({ s, name: [s.first_name, s.last_name].filter(Boolean).join(" ").trim() }))
    .filter(({ name }) => name && norm(name).includes(q))
    .sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)))
    .slice(0, PER_GROUP)
    .map(({ s, name }) => ({
      group: "staff" as const,
      id: s.user_id,
      title: name,
      subtitle: [s.role_name, s.department_name].filter(Boolean).join(" · ") || undefined,
      // Без права на карточку сотрудника ведём в список.
      href: detail ? `/people/staff/${s.user_id}` : "/people/staff",
      avatarUrl: s.avatar_url || null,
      person: true,
    }));
}

async function searchCandidates(db: LooseDb, query: string): Promise<PaletteHit[]> {
  const term = likeTerm(query);
  if (!term) return [];
  const digits = query.replace(/\D/g, "");
  const filters = [`full_name.ilike.%${term}%`, `desired_position.ilike.%${term}%`];
  if (digits.length >= 4) filters.push(`phone_normalized.ilike.%${digits}%`);
  const { data, error } = await db
    .from<Array<{ id: string; full_name: string | null; desired_position: string | null; status: string }>>(
      "candidates",
    )
    .select("id, full_name, desired_position, status")
    .is("archived_at", null)
    .neq("status", "hired")
    .or(filters.join(","))
    .order("submitted_at", { ascending: false })
    .limit(PER_GROUP);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    group: "candidates" as const,
    id: c.id,
    title: c.full_name || "Без имени",
    subtitle:
      [c.desired_position, CANDIDATE_STATUSES[c.status as keyof typeof CANDIDATE_STATUSES]]
        .filter(Boolean)
        .join(" · ") || undefined,
    href: `/people/candidates/${c.id}`,
    person: true,
  }));
}

async function searchGuests(db: LooseDb, query: string): Promise<PaletteHit[]> {
  const venue = await activeVenue(db);
  if (!venue) return [];
  const { data, error } = await db.rpc("crm_guest_list", {
    p_venue: venue,
    p_search: query.slice(0, 120),
    p_group: "",
    p_birthday: "",
    p_archived: false,
    p_page: 0,
    p_size: 25,
    p_sort: "name",
    p_desc: false,
  });
  if (error) throw new Error(error.message);
  const { data: account } = await db.rpc("get_active_account_id");
  const rows =
    (data as { rows?: Array<{ id: string; data: { name?: string; groupTitle?: string | null; photoPath?: string | null } }> } | null)
      ?.rows ?? [];
  return rows.slice(0, PER_GROUP).map((g) => {
    const path = g.data.photoPath;
    return {
      group: "guests" as const,
      id: g.id,
      title: g.data.name || "Гость",
      subtitle: g.data.groupTitle || undefined,
      href: `/crm/guests?guest=${g.id}`,
      // Тот же постоянный адрес, что в списке гостей (actions.ts → photo).
      avatarUrl:
        path && account && path.startsWith(`${account}/${venue}/`)
          ? mediaUrl("crm-guest-photos", path)
          : null,
      person: true,
    };
  });
}

async function searchActs(db: LooseDb, query: string, perms: Set<string>): Promise<PaletteHit[]> {
  const term = likeTerm(query.replace(/^№\s*/, ""));
  if (!term) return [];
  const { data, error } = await db
    .from<Array<{ id: string; document_number: string | null; invoice_date: string | null; status: string; comment: string | null }>>(
      "documents",
    )
    .select("id, document_number, invoice_date, status, comment")
    .eq("document_kind", "inventory")
    .is("archived_at", null)
    .or(`document_number.ilike.%${term}%,comment.ilike.%${term}%`)
    .order("invoice_date", { ascending: false })
    .limit(PER_GROUP);
  if (error) throw new Error(error.message);
  const results = perms.has("inventory.view_results");
  return (data ?? []).map((d) => ({
    group: "acts" as const,
    id: d.id,
    title: `Акт ${d.document_number ? `№ ${d.document_number}` : "без номера"}`,
    subtitle:
      [formatDateCell(d.invoice_date), INVENTORY_STATUS_LABEL[d.status]].filter(Boolean).join(" · ") ||
      undefined,
    // Подсчитанный акт открывается итогами — как из списка актов.
    href:
      results && (d.status === "processed" || d.status === "results_blocked")
        ? `/documents/inventory/${d.id}/results`
        : `/documents/inventory/${d.id}`,
  }));
}

async function searchTransactions(db: LooseDb, query: string): Promise<PaletteHit[]> {
  const { data, error } = await db.rpc("finance_transactions_page", {
    p_filters: { q: query },
    p_sort: [],
    p_limit: PER_GROUP,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);
  const rows =
    (data as {
      rows?: Array<{
        id: string;
        public_id: number | null;
        type: string;
        amount: number;
        currency: string | null;
        date: string;
        description: string | null;
      }>;
    } | null)?.rows ?? [];
  const sign = (type: string) => (type === "income" ? "+" : type === "expense" ? "−" : "");
  return rows.map((t) => ({
    group: "transactions" as const,
    id: t.id,
    title: t.description?.trim() || (t.public_id ? `Операция № ${t.public_id}` : "Операция"),
    subtitle: [formatDateCell(t.date), `${sign(t.type)}${formatMoney(Math.abs(t.amount), t.currency ?? "RUB")}`]
      .filter(Boolean)
      .join(" · "),
    href: `/finance/transactions?id=${t.id}`,
  }));
}

async function searchKnowledge(db: LooseDb, query: string): Promise<PaletteHit[]> {
  const { data, error } = await db.rpc("kb_search", { p_query: query, p_limit: PER_GROUP });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; slug: string; title: string; icon: string | null; icon_color: string | null }>).map(
    (p) => ({
      group: "knowledge" as const,
      id: p.id,
      title: p.title || "Без названия",
      href: `/knowledge/${p.slug}`,
      kbIcon: p.icon,
      kbIconColor: p.icon_color,
    }),
  );
}
