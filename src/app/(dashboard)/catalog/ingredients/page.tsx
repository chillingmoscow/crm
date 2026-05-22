import { redirect } from "next/navigation";
import { PackageSearch } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import {
  InventoryCatalogTree,
  type CatalogGroup,
  type CatalogProduct,
} from "./_components/inventory-catalog-tree";
import { InventorySyncButton } from "@/app/(dashboard)/inventory/_components/inventory-sync-button";
import { ScopeToggle } from "./_components/scope-toggle";

type GroupRow = {
  id: string;
  external_id: string;
  name: string;
  parent_group_id: string | null;
  primary_image_file_id: string | null;
};

type ProductRow = {
  id: string;
  external_id: string;
  name: string;
  article: string | null;
  barcode: string | null;
  measure_unit_name: string | null;
  current_prime_cost: number | null;
  store_quantity_kg: number | null;
  primary_image_file_id: string | null;
  group_id: string | null;
  archived_at: string | null;
  raw_payload: Record<string, unknown> | null;
};

function isQuickRestoProduct(row: ProductRow) {
  const className = typeof row.raw_payload?.className === "string" ? row.raw_payload.className : "";
  return className ? className.endsWith(".SingleProduct") : true;
}

async function createSignedImageUrls(accountId: string, fileIds: string[]) {
  const uniqueIds = Array.from(new Set(fileIds.filter(Boolean)));
  const imageUrlByFileId = new Map<string, string>();
  if (uniqueIds.length === 0) return imageUrlByFileId;

  const admin = asLooseDb(createAdminClient());
  const { data: files } = await admin
    .from<Array<{ id: string; storage_path: string }>>("account_files")
    .select("id, storage_path")
    .eq("account_id", accountId)
    .in("id", uniqueIds);

  const fileRows = files ?? [];
  if (fileRows.length === 0) return imageUrlByFileId;

  // Батч-подпись: один запрос к storage на все пути вместо N round-trip'ов
  // (createSignedUrl в Promise.all раньше тормозил каталог и refresh после
  // загрузки фото — особенно на списке из многих ингредиентов). Реальный
  // клиент: у loose-обёртки нет типа createSignedUrls.
  const { data: signedList } = await createAdminClient().storage
    .from("account-attachments")
    .createSignedUrls(fileRows.map((file) => file.storage_path), 60 * 60);
  const signedByPath = new Map<string, string>();
  for (const entry of signedList ?? []) {
    if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
  }
  for (const file of fileRows) {
    const url = signedByPath.get(file.storage_path);
    if (url) imageUrlByFileId.set(file.id, url);
  }

  return imageUrlByFileId;
}

export default async function InventoryProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  const supabase = await createClient();
  const db = asLooseDb(supabase);

  const [{ data: canView }, { data: canManage }, { data: canSync }, { data: accountId }, { data: activeVenueId }, amountRoundingScale] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "inventory.view_products" }),
    supabase.rpc("has_permission", { permission_code: "inventory.manage_products" }),
    supabase.rpc("has_permission", { permission_code: "inventory.sync_quickresto" }),
    supabase.rpc("get_active_account_id"),
    supabase.rpc("get_active_venue_id"),
    getActiveAccountAmountRoundingScale(),
  ]);
  if (!canView) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  // Сколько venue в аккаунте: при единственном venue toggle бессмыслен
  // (фильтр «этого заведения» совпадает с «весь каталог»). Скрываем
  // toggle и форсим режим «весь каталог» — это устраняет confusing
  // empty state при свежем QR-импорте, когда актов ещё нет.
  const { data: accountVenues } = await db
    .from<Array<{ id: string }>>("venues")
    .select("id")
    .eq("account_id", accountId);
  const venueCount = accountVenues?.length ?? 0;
  const multiVenue = venueCount > 1;

  // Дефолт — «весь каталог»:
  //   - При первом QR-импорте актов нет → toggle на «этого заведения»
  //     показывал бы пусто, что сбивало (Issue: empty groups + missing items).
  //   - Когда у user'а появятся реальные акты, он сам переключит, чтобы
  //     отфильтровать «что в этом venue».
  // При venueCount<=1 toggle всё равно скрыт, режим всегда «весь каталог».
  const venueScoped = multiVenue && scope === "venue";

  const { data: lastSynced } = await db
    .from<Array<{ synced_at: string | null }>>("ingredients")
    .select("synced_at")
    .eq("account_id", accountId)
    .eq("kind", "ingredient")
    .order("synced_at", { ascending: false })
    .range(0, 0);
  const lastSyncedAt = lastSynced?.[0]?.synced_at ?? null;

  const [{ data: groups }, { data: products }] = await Promise.all([
    db
      .from<GroupRow[]>("ingredient_groups")
      .select("id, external_id, name, parent_group_id, primary_image_file_id")
      .eq("account_id", accountId)
      .order("name"),
    db
      .from<ProductRow[]>("ingredients")
      .select("id, external_id, name, article, barcode, measure_unit_name, current_prime_cost, store_quantity_kg, primary_image_file_id, group_id, archived_at, raw_payload")
      .eq("account_id", accountId)
      // Этап 3: дерево — только ингредиенты. Будущие типы
      // (dish/product/semi_finished) не должны протекать сюда.
      .eq("kind", "ingredient")
      .order("name"),
  ]);

  // Тоггл «Этого заведения»: ингредиенты, встречающиеся в актах
  // активного venue. RLS уже venue-scope-ит documents/document_items;
  // дополнительно сужаем по venue_id активного заведения, чтобы режим
  // означал именно «этого заведения» (а не «всех видимых»).
  // venue-режим ВСЕГДА фильтрует (пустой набор без активного venue) —
  // иначе данные не соответствовали бы лейблу (Codex P1 #366).
  let venueIngredientIds: Set<string> | null = null;
  if (venueScoped) {
    venueIngredientIds = new Set();
    if (activeVenueId) {
      const { data: venueDocs } = await db
        .from<Array<{ id: string }>>("documents")
        .select("id")
        .eq("venue_id", activeVenueId);
      const docIds = (venueDocs ?? []).map((d) => d.id);
      if (docIds.length > 0) {
        const { data: usedItems } = await db
          .from<Array<{ ingredient_id: string | null }>>("document_items")
          .select("ingredient_id")
          .in("document_id", docIds);
        venueIngredientIds = new Set(
          (usedItems ?? [])
            .map((i) => i.ingredient_id)
            .filter((id): id is string => Boolean(id)),
        );
      }
    }
  }

  const productRows = (products ?? [])
    .filter((row) => !row.archived_at)
    .filter(isQuickRestoProduct)
    .filter((row) => !venueIngredientIds || venueIngredientIds.has(row.id));
  const imageUrlByFileId = await createSignedImageUrls(
    accountId,
    [
      ...(groups ?? []).map((group) => group.primary_image_file_id ?? ""),
      ...productRows.map((product) => product.primary_image_file_id ?? ""),
    ],
  );

  const catalogGroups: CatalogGroup[] = (groups ?? []).map((group) => ({
    id: group.id,
    externalId: group.external_id,
    name: group.name,
    parentGroupId: group.parent_group_id,
    imageUrl: group.primary_image_file_id
      ? imageUrlByFileId.get(group.primary_image_file_id) ?? null
      : null,
  }));

  const catalogProducts: CatalogProduct[] = productRows.map((product) => ({
    id: product.id,
    externalId: product.external_id,
    name: product.name,
    article: product.article,
    barcode: product.barcode,
    measureUnitName: product.measure_unit_name,
    currentPrimeCost: product.current_prime_cost,
    storeQuantityKg: product.store_quantity_kg,
    groupId: product.group_id,
    imageUrl: product.primary_image_file_id
      ? imageUrlByFileId.get(product.primary_image_file_id) ?? null
      : null,
  }));

  return (
    <div className="w-full px-4 py-4 md:px-8 md:py-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <PackageSearch className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold">Ингредиенты</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Дерево групп и ингредиентов Quick Resto с локальными фото для инвентаризации.
          </p>
        </div>
        <InventorySyncButton canSync={Boolean(canSync)} lastSyncedAt={lastSyncedAt} />
      </div>

      {multiVenue ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <ScopeToggle value={venueScoped ? "venue" : "all"} />
          {venueScoped && !activeVenueId ? (
            <span className="text-sm text-muted-foreground">
              Активное заведение не выбрано — переключитесь на «Весь каталог».
            </span>
          ) : venueScoped && productRows.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              В этом заведении пока нет актов с ингредиентами — переключитесь на «Весь каталог».
            </span>
          ) : null}
        </div>
      ) : null}

      <InventoryCatalogTree
        groups={catalogGroups}
        products={catalogProducts}
        canManage={Boolean(canManage)}
        amountRoundingScale={amountRoundingScale}
      />
    </div>
  );
}
