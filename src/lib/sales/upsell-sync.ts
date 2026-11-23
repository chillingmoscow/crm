import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { queuePayroll } from "@/lib/payroll/sync";
import type { Order, OrderDetail } from "./calculate";
import { salesSettingsColumns, type SalesSettings } from "./types";
import { countUpsellDay, type UpsellCatalog, type UpsellLine } from "./upsell";

const GENERIC_ERROR = "Не удалось посчитать допродажи. Повторим автоматически";

class UpsellDayError extends Error {}

export async function scheduleUpsellDays() {
  const r = await asLooseDb(createAdminClient()).rpc("sales_schedule_upsell_days");
  if (r.error) throw new Error("Не удалось запланировать допродажи по подразделениям");
  return Number(r.data ?? 0);
}

type ItemRow = { external_id: string; kind: "dish" | "modifier"; name: string; group_id: string | null };
type GroupRow = {
  id: string;
  external_id: string;
  kind: "dish" | "modifier";
  name: string;
  parent_group_id: string | null;
};

/**
 * Каталог блюд, модификаторов и их групп (архивные тоже — в старых чеках они есть).
 * `syncedAt` — максимум `synced_at` по ВСЕМ позициям аккаунта любого вида:
 * ровно то, с чем сравнивает очередь, когда решает пересчитать день.
 */
export async function loadUpsellCatalog(
  db: LooseDb,
  accountId: string,
): Promise<{ catalog: UpsellCatalog; syncedAt: string | null }> {
  const [items, groups, latest] = await Promise.all([
    fetchAllRows<ItemRow>(() =>
      db
        .from<ItemRow[]>("ingredients")
        .select("external_id,kind,name,group_id")
        .eq("account_id", accountId)
        .in("kind", ["dish", "modifier"]),
    ),
    fetchAllRows<GroupRow>(() =>
      db
        .from<GroupRow[]>("ingredient_groups")
        .select("id,external_id,kind,name,parent_group_id")
        .eq("account_id", accountId)
        .in("kind", ["dish", "modifier"]),
    ),
    db
      .from<{ synced_at: string }[]>("ingredients")
      .select("synced_at")
      .eq("account_id", accountId)
      .order("synced_at", { ascending: false })
      .limit(1),
  ]);
  if (latest.error) throw new Error(latest.error.message);
  const groupKey = new Map(groups.map((g) => [g.id, `${g.kind}_group:${g.external_id}`]));
  const catalog: UpsellCatalog = { items: new Map(), groups: new Map() };
  for (const g of groups)
    catalog.groups.set(`${g.kind}_group:${g.external_id}`, {
      name: g.name,
      parent: g.parent_group_id ? (groupKey.get(g.parent_group_id) ?? null) : null,
    });
  for (const i of items)
    catalog.items.set(`${i.kind}:${i.external_id}`, {
      name: i.name,
      group: i.group_id ? (groupKey.get(i.group_id) ?? null) : null,
    });
  return { catalog, syncedAt: latest.data?.[0]?.synced_at ?? null };
}

type Claim = {
  id: string;
  account_id: string;
  venue_id: string;
  department_id: string;
  date: string;
  rule_id: string;
  lines: UpsellLine[];
  job_id: string | null;
  lease_token: string;
};

/** Один день подразделения: чеки из загрузки дня → подсчёт → фиксация → зарплата. */
export async function processUpsellDay(): Promise<{ idle: boolean; error?: boolean }> {
  const db = asLooseDb(createAdminClient());
  const claimed = await db.rpc("sales_claim_upsell_day");
  if (claimed.error) throw new Error("Не удалось получить задание допродаж по подразделениям");
  const day = claimed.data as Claim | null;
  if (!day) return { idle: true };
  try {
    if (!day.job_id) throw new UpsellDayError("Чеки дня ещё не загружены");
    const jobRow = await db
      .from<{ payload: { orders_count: number; staff_ids: number[] } }>("sales_sync_jobs")
      .select("payload")
      .eq("id", day.job_id)
      .single();
    if (jobRow.error || !jobRow.data) throw new Error("Не найдена загрузка чеков дня");
    const payload = jobRow.data.payload;

    const all: { order_data: Order; detail_data: OrderDetail }[] = [];
    for (let start = 0; ; start += 1000) {
      const r = await db
        .from<typeof all>("sales_sync_receipts")
        .select("order_data,detail_data")
        .eq("job_id", day.job_id)
        .order("order_id")
        .range(start, start + 999);
      if (r.error) throw new Error(r.error.message);
      all.push(...(r.data ?? []));
      if ((r.data?.length ?? 0) < 1000) break;
    }
    if (all.length !== payload.orders_count || all.some((r) => !r.detail_data))
      throw new UpsellDayError("Не все чеки дня загружены");

    const settings = await db
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("account_id", day.account_id)
      .eq("venue_id", day.venue_id)
      .single();
    if (settings.error || !settings.data) throw new UpsellDayError("Продажи не настроены");

    const { catalog, syncedAt } = await loadUpsellCatalog(db, day.account_id);

    let result;
    try {
      result = countUpsellDay({
        orders: all.map((r) => r.order_data),
        details: all.map((r) => r.detail_data),
        staffIds: payload.staff_ids,
        lines: day.lines,
        catalog,
        settings: settings.data,
      });
    } catch (e) {
      // Тексты ошибок upsell.ts русские и понятны пользователю.
      throw new UpsellDayError(
        e instanceof Error && /[А-Яа-яЁё]/.test(e.message) ? e.message : GENERIC_ERROR,
      );
    }

    const saved = await db.rpc("sales_commit_upsell_day", {
      p_id: day.id,
      p_lease: day.lease_token,
      p_job: day.job_id,
      p_catalog_at: syncedAt,
      p_result: result,
    });
    if (saved.error) throw new Error(saved.error.message);
    if (saved.data === true) {
      // Зарплата дня должна учесть готовую прибавку. День уже зафиксирован:
      // сбой постановки (например, зарплата у заведения выключена) его не откатывает —
      // планировщик зарплаты всё равно пересчитывает недавние дни.
      try {
        await queuePayroll(day.account_id, day.venue_id, [day.date]);
      } catch {}
    }
    return { idle: false };
  } catch (error) {
    const message = error instanceof UpsellDayError ? error.message : GENERIC_ERROR;
    const failed = await db.rpc("sales_fail_upsell_day", {
      p_id: day.id,
      p_lease: day.lease_token,
      p_error: message,
    });
    if (failed.error) throw new Error("Не удалось сохранить ошибку допродаж по подразделениям");
    return { idle: false, error: true };
  }
}
