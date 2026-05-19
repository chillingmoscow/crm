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
};

type InventoryDocumentItemRow = {
  id: string;
  inventory_product_id: string | null;
  product_name: string;
  article: string | null;
  barcode: string | null;
  measure_unit_name: string | null;
  actual_amount: number | null;
  submitted_amount: number | null;
  sort_order: number;
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
    const groupId = item.inventory_product_id
      ? productById.get(item.inventory_product_id)?.group_id ?? null
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
    .select("id, account_id, document_number, store_id, assigned_to, status, processed, base_last_update_date")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (!document) notFound();
  if (!canView && document.assigned_to !== user.id) redirect("/documents");

  const [{ data: store }, { data: itemsRaw }, { data: groupsRaw }] = await Promise.all([
    document.store_id
      ? admin.from<InventoryStoreTitleRow>("stores").select("title").eq("id", document.store_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from<InventoryDocumentItemRow[]>("document_items")
      .select("id, inventory_product_id, product_name, article, barcode, measure_unit_name, actual_amount, submitted_amount, sort_order")
      .eq("document_id", document.id)
      .order("sort_order"),
    admin
      .from<InventoryProductGroupRow[]>("ingredient_groups")
      .select("id, name, parent_group_id")
      .eq("account_id", accountId),
  ]);

  const items = itemsRaw ?? [];
  const productIds = items.map((item) => item.inventory_product_id).filter((productId): productId is string => Boolean(productId));
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

    await Promise.all(
      productRows.map(async (product) => {
        const path = product.primary_image_file_id ? filePathById.get(product.primary_image_file_id) : null;
        if (!path) {
          imageByProductId.set(product.id, null);
          return;
        }
        const { data: signed } = await admin.storage
          .from("account-attachments")
          .createSignedUrl(path, 60 * 60);
        imageByProductId.set(product.id, signed?.signedUrl ?? null);
      })
    );
  }

  return (
    <InventoryDocumentEditor
      document={{
        id: document.id,
        documentNumber: document.document_number,
        storeTitle: store?.title ?? null,
        status: document.status,
        baseLastUpdateDate: document.base_last_update_date ?? null,
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
        imageUrl: item.inventory_product_id ? imageByProductId.get(item.inventory_product_id) ?? null : null,
        groupId: item.inventory_product_id ? productById.get(item.inventory_product_id)?.group_id ?? null : null,
        groupPath: item.inventory_product_id
          ? groupPathById.get(productById.get(item.inventory_product_id)?.group_id ?? "") ?? null
          : null,
      }))}
    />
  );
}
