import { redirect } from "next/navigation";

import type { CatalogKindConfig } from "../_lib/kinds";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import { CatalogTable } from "./catalog-table";
import type { CatalogGroup, CatalogProduct } from "./catalog-tree";

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
};

/**
 * Подписанные ссылки на фото. id и пути режем на части: фото может быть у
 * каждой из тысячи позиций, а список id в `.in(...)` уходит в URL запроса.
 */
async function createSignedImageUrls(accountId: string, fileIds: string[]) {
  const uniqueIds = Array.from(new Set(fileIds.filter(Boolean)));
  const imageUrlByFileId = new Map<string, string>();
  if (uniqueIds.length === 0) return imageUrlByFileId;

  const admin = asLooseDb(createAdminClient());
  const fileRows = (
    await Promise.all(
      chunk(uniqueIds, 150).map(async (ids) => {
        const { data } = await admin
          .from<Array<{ id: string; storage_path: string }>>("account_files")
          .select("id, storage_path")
          .eq("account_id", accountId)
          .in("id", ids);
        return data ?? [];
      }),
    )
  ).flat();
  if (fileRows.length === 0) return imageUrlByFileId;

  // Батч-подпись: один запрос к storage на пачку путей вместо N round-trip'ов
  // (createSignedUrl в Promise.all раньше тормозил каталог и refresh после
  // загрузки фото). Реальный клиент: у loose-обёртки нет типа createSignedUrls.
  const storage = createAdminClient().storage.from("account-attachments");
  const signedByPath = new Map<string, string>();
  for (const paths of chunk(fileRows.map((file) => file.storage_path), 500)) {
    const { data: signedList } = await storage.createSignedUrls(paths, 60 * 60);
    for (const entry of signedList ?? []) {
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }
  for (const file of fileRows) {
    const url = signedByPath.get(file.storage_path);
    if (url) imageUrlByFileId.set(file.id, url);
  }

  return imageUrlByFileId;
}

/**
 * Список одного раздела каталога: дерево категорий и позиций.
 *
 * Один компонент на все три раздела — различия вынесены в CATALOG_KINDS.
 */
export async function NomenclatureCatalog({
  config,
  scope,
}: {
  config: CatalogKindConfig;
  scope?: string;
}) {
  const supabase = await createClient();
  const db = asLooseDb(supabase);

  const [can, accountId, { data: activeVenueId }] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
    supabase.rpc("get_active_venue_id"),
  ]);
  const canView = can("inventory.view_products");
  const canManage = can("inventory.manage_products");
  const canSync = can("inventory.sync_quickresto");
  if (!canView) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  // Всё, что не зависит друг от друга, — одним заходом: заведения аккаунта,
  // время последней синхронизации, категории и позиции раздела.
  // Категории и позиции читаем постранично: PostgREST отдаёт не больше 1000
  // строк, а в справочнике ингредиентов их бывает больше.
  const [{ data: accountVenues }, { data: lastSynced }, groups, products] =
    await Promise.all([
      db.from<Array<{ id: string }>>("venues").select("id").eq("account_id", accountId),
      db
        .from<Array<{ synced_at: string | null }>>("ingredients")
        .select("synced_at")
        .eq("account_id", accountId)
        .eq("kind", config.kind)
        .order("synced_at", { ascending: false })
        .range(0, 0),
      fetchAllRows(() =>
        db
          .from<GroupRow[]>("ingredient_groups")
          .select("id, external_id, name, parent_group_id, primary_image_file_id")
          .eq("account_id", accountId)
          // Категории строго своего раздела: у блюд и полуфабрикатов свои деревья.
          .eq("kind", config.kind),
      ),
      fetchAllRows(() =>
        db
          .from<ProductRow[]>("ingredients")
          .select("id, external_id, name, article, barcode, measure_unit_name, current_prime_cost, store_quantity_kg, primary_image_file_id, group_id, archived_at")
          .eq("account_id", accountId)
          .eq("kind", config.kind),
      ),
    ]);
  const lastSyncedAt = lastSynced?.[0]?.synced_at ?? null;

  // Сколько venue в аккаунте: при единственном venue переключатель бессмыслен
  // (фильтр «этого заведения» совпадает с «весь каталог») — скрываем его и
  // всегда показываем весь каталог. Это убирает пустой список при свежем
  // импорте из Quick Resto, когда актов ещё нет.
  const multiVenue = (accountVenues?.length ?? 0) > 1;

  // Дефолт — «весь каталог»: при первом импорте актов нет, и «этого
  // заведения» показывал бы пустоту. Сузить список человек может сам.
  const venueScoped = multiVenue && scope === "venue";

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
      const venueDocs = await fetchAllRows(() =>
        db
          .from<Array<{ id: string }>>("documents")
          .select("id")
          .eq("venue_id", activeVenueId),
      );
      const docIds = venueDocs.map((d) => d.id);
      for (const ids of chunk(docIds, 150)) {
        const usedItems = await fetchAllRows(() =>
          db
            .from<Array<{ id: string; ingredient_id: string | null }>>("document_items")
            .select("id, ingredient_id")
            .in("document_id", ids),
        );
        for (const item of usedItems) {
          if (item.ingredient_id) venueIngredientIds.add(item.ingredient_id);
        }
      }
    }
  }

  // Фильтра по className здесь больше нет. Он появился, когда вид позиции в
  // каталоге ничем не отличался и в дерево ингредиентов могли попасть чужие
  // строки; теперь вид отбирается запросом выше и записывается синком по
  // классу Quick Resto, так что проверка была бы дублем — а после появления
  // разделов ещё и вредным: она пропускала только `.SingleProduct` и вычистила
  // бы из блюд и полуфабрикатов вообще все позиции, оставив пустые категории.
  //
  // Архивные позиции (удалённые в Quick Resto) отдаём вместе с живыми: список
  // переключается на них кнопкой «Архив» без похода на сервер. Тоггл
  // заведения к архиву не применяется — архив и так небольшой.
  const productRows = products.filter(
    (row) => row.archived_at || !venueIngredientIds || venueIngredientIds.has(row.id),
  );
  const imageUrlByFileId = await createSignedImageUrls(
    accountId,
    [
      ...groups.map((group) => group.primary_image_file_id ?? ""),
      ...productRows.map((product) => product.primary_image_file_id ?? ""),
    ],
  );

  const catalogGroups: CatalogGroup[] = groups.map((group) => ({
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
    storeQuantity: product.store_quantity_kg,
    groupId: product.group_id,
    imageUrl: product.primary_image_file_id
      ? imageUrlByFileId.get(product.primary_image_file_id) ?? null
      : null,
    archived: Boolean(product.archived_at),
  }));

  // Почему «этого заведения» может оказаться пустым — объясняем в пустом
  // состоянии списка, а не отдельной строкой над ним.
  const scopeNotice = !venueScoped
    ? null
    : !activeVenueId
      ? "Активное заведение не выбрано"
      : "В актах этого заведения таких позиций пока нет";

  return (
    <CatalogTable
      config={config}
      groups={catalogGroups}
      products={catalogProducts}
      canManage={canManage}
      canSync={canSync}
      lastSyncedAt={lastSyncedAt}
      scope={multiVenue ? (venueScoped ? "venue" : "all") : null}
      scopeNotice={scopeNotice}
    />
  );
}
