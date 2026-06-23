import { notFound, redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { InventoryDocumentEditor } from "./_components/document-editor";

type InventoryDocumentDetailRow = {
  id: string;
  account_id: string;
  document_number: string;
  store_id: string | null;
  assigned_to: string | null;
  status: string;
  processed: boolean;
  base_last_update_date: string | null;
  synced_at: string | null;
  last_returned_at: string | null;
  recount_count: number | null;
  archived_at: string | null;
};

type InventoryDocumentItemRow = {
  id: string;
  ingredient_id: string | null;
  product_name: string;
  article: string | null;
  barcode: string | null;
  measure_unit_name: string | null;
  actual_amount: number | null;
  submitted_amount: number | null;
  sort_order: number;
  needs_recount: boolean | null;
  recount_note: string | null;
};

type InventoryStoreTitleRow = {
  title: string;
};

type InventoryProductImageRow = {
  id: string;
  primary_image_file_id: string | null;
  group_id: string | null;
};

type AccountFilePathRow = {
  id: string;
  storage_path: string;
};

type InventoryProductGroupRow = {
  id: string;
  name: string;
  parent_group_id: string | null;
};

function buildGroupPaths(groups: InventoryProductGroupRow[]) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const childrenByParentId = new Map<string | null, InventoryProductGroupRow[]>();

  for (const group of groups) {
    const parentId = group.parent_group_id && byId.has(group.parent_group_id) ? group.parent_group_id : null;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(group);
    childrenByParentId.set(parentId, children);
  }

  for (const children of childrenByParentId.values()) {
    children.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }

  const ordered: Array<{ group: InventoryProductGroupRow; depth: number; path: string }> = [];
  const pathById = new Map<string, string>();
  const visited = new Set<string>();

  function walk(parentId: string | null, depth: number, parentPath: string[]) {
    for (const group of childrenByParentId.get(parentId) ?? []) {
      if (visited.has(group.id)) continue;
      visited.add(group.id);
      const pathParts = [...parentPath, group.name];
      const path = pathParts.join(" / ");
      pathById.set(group.id, path);
      ordered.push({ group, depth, path });
      walk(group.id, depth + 1, pathParts);
    }
  }

  walk(null, 0, []);
  for (const group of groups.sort((left, right) => left.name.localeCompare(right.name, "ru"))) {
    if (visited.has(group.id)) continue;
    const path = group.name;
    pathById.set(group.id, path);
    ordered.push({ group, depth: 0, path });
  }

  return { ordered, pathById, byId };
}

function groupsUsedByDocument(
  orderedGroups: Array<{ group: InventoryProductGroupRow; depth: number; path: string }>,
  byId: Map<string, InventoryProductGroupRow>,
  productById: Map<string, InventoryProductImageRow>,
  items: InventoryDocumentItemRow[]
) {
  const allowed = new Set<string>();

  for (const item of items) {
    const groupId = item.ingredient_id
      ? productById.get(item.ingredient_id)?.group_id ?? null
      : null;
    let currentId = groupId;
    const guard = new Set<string>();
    while (currentId && !guard.has(currentId)) {
      guard.add(currentId);
      allowed.add(currentId);
      currentId = byId.get(currentId)?.parent_group_id ?? null;
    }
  }

  return orderedGroups.filter(({ group }) => allowed.has(group.id));
}

export default async function InventoryDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const admin = asLooseDb(createAdminClient());

  const [
    { data: accountId },
    { data: canView },
    { data: canFill },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
    supabase.auth.getUser(),
  ]);

  if (!user) redirect("/login");
  if (!accountId || (!canView && !canFill)) redirect("/dashboard");

  const { data: document } = await admin
    .from<InventoryDocumentDetailRow>("documents")
    .select("id, account_id, document_number, store_id, assigned_to, status, processed, base_last_update_date, synced_at, last_returned_at, recount_count, archived_at")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (!document) notFound();
  // Акт удалён в Quick Resto (авто-архив) — скрыт из списка; закрываем и прямой
  // доступ по URL/закладке, чтобы нельзя было редактировать мёртвый акт.
  if (document.archived_at) redirect("/documents/inventory");
  if (!canView && document.assigned_to !== user.id) redirect("/documents/inventory");

  const [{ data: store }, { data: itemsRaw }, { data: groupsRaw }] = await Promise.all([
    document.store_id
      ? admin.from<InventoryStoreTitleRow>("stores").select("title").eq("id", document.store_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from<InventoryDocumentItemRow[]>("document_items")
      .select("id, ingredient_id, product_name, article, barcode, measure_unit_name, actual_amount, submitted_amount, sort_order, needs_recount, recount_note")
      .eq("document_id", document.id)
      .order("sort_order"),
    admin
      .from<InventoryProductGroupRow[]>("ingredient_groups")
      .select("id, name, parent_group_id")
      .eq("account_id", accountId),
  ]);

  const items = itemsRaw ?? [];
  const productIds = items.map((item) => item.ingredient_id).filter((productId): productId is string => Boolean(productId));
  const imageByProductId = new Map<string, string | null>();
  const productById = new Map<string, InventoryProductImageRow>();
  const {
    ordered: orderedGroups,
    pathById: groupPathById,
    byId: groupById,
  } = buildGroupPaths(groupsRaw ?? []);

  if (productIds.length > 0) {
    const { data: products } = await admin
      .from<InventoryProductImageRow[]>("ingredients")
      .select("id, primary_image_file_id, group_id")
      .eq("account_id", accountId)
      .in("id", productIds);
    const productRows = products ?? [];
    for (const product of productRows) {
      productById.set(product.id, product);
    }
    const fileIds = productRows
      .map((product) => product.primary_image_file_id)
      .filter((fileId): fileId is string => Boolean(fileId));
    const filePathById = new Map<string, string>();
    if (fileIds.length > 0) {
      const { data: files } = await admin
        .from<AccountFilePathRow[]>("account_files")
        .select("id, storage_path")
        .eq("account_id", accountId)
        .in("id", fileIds);
      for (const file of files ?? []) {
        filePathById.set(file.id, file.storage_path);
      }
    }

    // Батч-подпись всех фото одним запросом к storage (вместо N round-trip'ов
    // createSignedUrl в Promise.all — заметно ускоряет загрузку формы акта).
    const allPaths = Array.from(new Set(Array.from(filePathById.values())));
    const signedByPath = new Map<string, string>();
    if (allPaths.length > 0) {
      // Реальный клиент: у loose-обёртки нет типа createSignedUrls.
      const { data: signedList } = await createAdminClient().storage
        .from("account-attachments")
        .createSignedUrls(allPaths, 60 * 60);
      for (const entry of signedList ?? []) {
        if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
      }
    }
    for (const product of productRows) {
      const path = product.primary_image_file_id ? filePathById.get(product.primary_image_file_id) : null;
      imageByProductId.set(product.id, path ? signedByPath.get(path) ?? null : null);
    }
  }

  return (
    <InventoryDocumentEditor
      document={{
        id: document.id,
        documentNumber: document.document_number,
        storeTitle: store?.title ?? null,
        status: document.status,
        processed: document.processed,
        // prefillFromActual: actual_amount = реальные числа исполнителя для
        // актов, которые уже считали (review / recount / проведён). Для свежего
        // черновика первого счёта (synced / assigned / in_progress без
        // возвратов) actual_amount = QR-нули — fallback подавлен (см.
        // editorInitialValue). Иначе форма «100% заполнена нулями», а при
        // проверке/пересчёте не видно реально введённого (regression #478).
        prefillFromActual: !(
          document.status === "synced" ||
          document.status === "assigned" ||
          (document.status === "in_progress" && (document.recount_count ?? 0) === 0)
        ),
        baseLastUpdateDate: document.base_last_update_date ?? null,
        // syncedAt + lastReturnedAt — для editor hydration: draft до любого
        // из этих timestamp'ов = stale (см. document-editor.tsx draft-stale).
        syncedAt: document.synced_at ?? null,
        lastReturnedAt: document.last_returned_at ?? null,
        recountCount: document.recount_count ?? 0,
      }}
      groups={groupsUsedByDocument(orderedGroups, groupById, productById, items).map(({ group, depth, path }) => ({
        id: group.id,
        name: group.name,
        parentGroupId: group.parent_group_id,
        depth,
        path,
      }))}
      items={items.map((item) => ({
        id: item.id,
        productName: item.product_name,
        article: item.article,
        barcode: item.barcode,
        measureUnitName: item.measure_unit_name,
        actualAmount: item.actual_amount,
        submittedAmount: item.submitted_amount,
        needsRecount: Boolean(item.needs_recount),
        recountNote: item.recount_note ?? null,
        imageUrl: item.ingredient_id ? imageByProductId.get(item.ingredient_id) ?? null : null,
        groupId: item.ingredient_id ? productById.get(item.ingredient_id)?.group_id ?? null : null,
        groupPath: item.ingredient_id
          ? groupPathById.get(productById.get(item.ingredient_id)?.group_id ?? "") ?? null
          : null,
      }))}
    />
  );
}
