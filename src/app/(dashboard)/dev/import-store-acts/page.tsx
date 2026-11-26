import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageFrame } from "@/components/shared/page-frame";
import { countConfigSchema } from "@/lib/stock-count/tobacco-weighing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedUser } from "@/lib/supabase/server";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";

import { getStoreActsImportAccess } from "./access";
import { ImportStoreActsClient } from "./import-client";

export const metadata: Metadata = { title: "Загрузка актов склада" };

/** Табак CHILLING в Quick Resto: «Стандарт», «Премиум», «Парфюм». */
const FALLBACK_PRODUCT_IDS = [417, 420, 1892];
const DEFAULT_FROM = "2026-10-01";

type StoreOption = { id: string; title: string };

/**
 * Склад и позиции по умолчанию — из настройки задачи-взвешивания аккаунта,
 * если она есть. Без неё (или до миграции 395) — табачные позиции CHILLING.
 */
async function loadDefaults(admin: LooseDb, accountId: string, stores: StoreOption[]) {
  let storeId: string | null = null;
  let productIds = FALLBACK_PRODUCT_IDS;
  const { data: definitions, error } = await admin
    .from<Array<{ count_config: unknown }>>("schedule_task_definitions")
    .select("count_config")
    .eq("account_id", accountId)
    .eq("kind", "stock_count")
    .is("deleted_at", null)
    .limit(1);
  const config = !error && definitions?.[0] ? countConfigSchema.safeParse(definitions[0].count_config) : null;
  if (config?.success) {
    if (stores.some((store) => store.id === config.data.storeId)) storeId = config.data.storeId;
    const ingredientIds = config.data.sections.map((section) => section.productId);
    const { data: ingredients } = await admin
      .from<Array<{ id: string; external_id: string | null }>>("ingredients")
      .select("id, external_id")
      .eq("account_id", accountId)
      .in("id", ingredientIds);
    const external = (ingredients ?? [])
      .map((row) => Number(row.external_id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (external.length === ingredientIds.length) productIds = external;
  }
  storeId ??= stores.find((store) => /кальян/i.test(store.title))?.id ?? stores[0]?.id ?? "";
  return { storeId, productIds };
}

/**
 * /dev/import-store-acts — разовая загрузка проведённых актов склада из Quick
 * Resto (взвешивания табака из n8n). Только владелец аккаунта с правом
 * проводить итоги; остальным страницы нет (notFound).
 */
export default async function ImportStoreActsPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const access = await getStoreActsImportAccess();
  if (!access) notFound();

  const admin = asLooseDb(createAdminClient());
  const { data: storeRows } = await admin
    .from<Array<{ id: string; title: string | null; external_id: string | null }>>("stores")
    .select("id, title, external_id")
    .eq("account_id", access.accountId)
    .is("archived_at", null)
    .order("title");
  const stores: StoreOption[] = (storeRows ?? [])
    .filter((row) => row.external_id)
    .map((row) => ({ id: row.id, title: row.title ?? "Склад без названия" }));
  const defaults = await loadDefaults(admin, access.accountId, stores);

  return (
    <PageFrame>
      <div className="mx-auto flex w-full min-w-0 max-w-[960px] flex-col gap-6">
        <h1 className="text-[28px] sm:text-4xl">Загрузка актов склада</h1>
        <ImportStoreActsClient
          stores={stores}
          defaultStoreId={defaults.storeId}
          defaultFrom={DEFAULT_FROM}
          defaultProductIds={defaults.productIds.join(", ")}
        />
      </div>
    </PageFrame>
  );
}
