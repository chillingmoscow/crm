"use server";

import { createClient } from "@/lib/supabase/server";
import { createKbPage } from "@/lib/knowledge/pages";
import {
  KB_COLLECTION_DEFAULT_TITLE,
  KB_COLLECTION_EMPTY_SCHEMA,
  KB_COLLECTION_VIEW_LABELS,
  collectionFiltersToJsonValue,
  collectionVisibleFieldIdsToJsonValue,
  collectionSchemaToProperties,
  getPageCollectionId,
  mergeCollectionSchemaProperties,
  normalizeCollectionTitle,
  normalizeCollectionViewName,
  normalizeCollectionViewType,
  parseCollectionSchemaJson,
  parseCollectionFiltersJson,
  parseVisibleFieldIdsJson,
  serializeCollectionSchema,
  type KbCollection,
  type KbCollectionFilter,
  type KbCollectionLegacyBlock,
  type KbCollectionSchema,
  type KbCollectionView,
  type KbCollectionViewConfig,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
import { kbPropertiesSchema } from "@/lib/knowledge/schemas";
import type { Json } from "@/types/database";
import type { KbProperty } from "@/types/knowledge";

export type KbCollectionItem = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
  cover_url: string | null;
  plain_text: string;
  properties: KbProperty[];
  position: number;
  updated_at: string | null;
};

export type KbCollectionState = {
  collection: KbCollection;
  views: KbCollectionViewConfig[];
  activeViewId: string;
  legacyViewIdsByBlockId: Record<string, string>;
};

type CollectionRow = {
  id: string;
  page_id: string;
  collection_key: string;
  title: string;
  schema_json: Json;
};

type CollectionViewRow = {
  id: string;
  collection_id: string;
  name: string;
  view_type: string;
  visible_field_ids: Json | null;
  field_order_ids: Json | null;
  filters_json: Json;
  position: number;
  source_block_id: string | null;
};

const COLLECTION_VIEW_SELECT =
  "id, collection_id, name, view_type, visible_field_ids, field_order_ids, filters_json, position, source_block_id" as const;

export async function listKbCollectionItems(parentPageId: string): Promise<{
  rows: KbCollectionItem[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select(
      "id, slug, title, icon, icon_color, cover_url, plain_text, properties, position, updated_at",
    )
    .eq("parent_id", parentPageId)
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .order("title", { ascending: true });

  if (error) return { rows: [], error: error.message };

  const rows = (data ?? []).map((row) => {
    const parsed = kbPropertiesSchema.safeParse(
      (row as { properties?: unknown }).properties ?? [],
    );
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      icon: row.icon,
      icon_color: row.icon_color,
      cover_url: row.cover_url,
      plain_text: row.plain_text ?? "",
      position: row.position ?? 0,
      updated_at: row.updated_at,
      properties: parsed.success ? parsed.data : [],
    } satisfies KbCollectionItem;
  });

  return { rows, error: null };
}

export async function getOrCreateKbPageCollection(input: {
  pageId: string;
  blockId: string;
  preferredViewId?: string | null;
  legacyBlocks?: KbCollectionLegacyBlock[];
}): Promise<{ state: KbCollectionState | null; error: string | null }> {
  const supabase = await createClient();
  const { data: accountId, error: accountError } = await supabase.rpc(
    "get_active_account_id",
  );
  if (accountError || !accountId) {
    return {
      state: null,
      error: accountError?.message ?? "Нет активного аккаунта",
    };
  }

  const legacyBlocks = normalizeLegacyBlocks(input.legacyBlocks ?? []);
  const collectionKey = getPageCollectionId(input.pageId);
  const canonicalSchema = pickCanonicalLegacySchema(legacyBlocks);
  const canonicalTitle = pickCanonicalLegacyTitle(legacyBlocks);

  const existingResult = await supabase
    .from("kb_collections")
    .select("id, page_id, collection_key, title, schema_json")
    .eq("page_id", input.pageId)
    .maybeSingle();

  if (existingResult.error) {
    return { state: null, error: existingResult.error.message };
  }

  let collectionRow = existingResult.data as CollectionRow | null;
  if (!collectionRow) {
    const insertResult = await supabase
      .from("kb_collections")
      .insert({
        account_id: accountId,
        page_id: input.pageId,
        collection_key: collectionKey,
        title: canonicalTitle,
        schema_json: schemaToJsonValue(canonicalSchema),
      })
      .select("id, page_id, collection_key, title, schema_json")
      .single();

    if (insertResult.error) {
      if (insertResult.error.code !== "23505") {
        return { state: null, error: insertResult.error.message };
      }
      const retry = await supabase
        .from("kb_collections")
        .select("id, page_id, collection_key, title, schema_json")
        .eq("page_id", input.pageId)
        .maybeSingle();
      if (retry.error || !retry.data) {
        return {
          state: null,
          error: retry.error?.message ?? "Не удалось создать коллекцию",
        };
      }
      collectionRow = retry.data as CollectionRow;
    } else {
      collectionRow = insertResult.data as CollectionRow;
    }
  }

  const currentSchema = parseCollectionSchemaJson(collectionRow.schema_json);
  const needsCollectionBackfill =
    collectionRow.collection_key !== collectionKey ||
    (currentSchema.fields.length === 0 && canonicalSchema.fields.length > 0) ||
    (normalizeCollectionTitle(collectionRow.title) === KB_COLLECTION_DEFAULT_TITLE &&
      canonicalTitle !== KB_COLLECTION_DEFAULT_TITLE);

  if (needsCollectionBackfill) {
    const updateResult = await supabase
      .from("kb_collections")
      .update({
        collection_key: collectionKey,
        ...(currentSchema.fields.length === 0 && canonicalSchema.fields.length > 0
          ? {
              schema_json: schemaToJsonValue(canonicalSchema),
            }
          : {}),
        ...(normalizeCollectionTitle(collectionRow.title) ===
          KB_COLLECTION_DEFAULT_TITLE &&
        canonicalTitle !== KB_COLLECTION_DEFAULT_TITLE
          ? { title: canonicalTitle }
          : {}),
      })
      .eq("id", collectionRow.id)
      .select("id, page_id, collection_key, title, schema_json")
      .single();
    if (updateResult.error) {
      return { state: null, error: updateResult.error.message };
    }
    collectionRow = updateResult.data as CollectionRow;
  }

  let views = await listCollectionViewRows(collectionRow.id);
  if ("error" in views) return { state: null, error: views.error };

  const legacyViewIdsByBlockId: Record<string, string> = {};
  if (views.length === 0) {
    const legacyViews =
      legacyBlocks.length > 0
        ? legacyBlocks
        : [
            {
              blockId: input.blockId,
              view: "list" as const,
              viewTitle: KB_COLLECTION_VIEW_LABELS.list,
              visibleFieldIdsJson: "",
              fieldOrderIdsJson: "",
            },
          ];

    const rows = legacyViews.map((legacy, index) => ({
      account_id: accountId,
      collection_id: collectionRow.id,
      name: normalizeCollectionViewName(legacy.viewTitle, legacy.view ?? "list"),
      view_type: legacy.view ?? "list",
      visible_field_ids: collectionVisibleFieldIdsToJsonValue(
        parseVisibleFieldIdsJson(legacy.visibleFieldIdsJson),
      ) as unknown as Json | null,
      field_order_ids: collectionVisibleFieldIdsToJsonValue(
        parseVisibleFieldIdsJson(legacy.fieldOrderIdsJson),
      ) as unknown as Json | null,
      filters_json: [],
      position: index,
      source_block_id: legacy.blockId,
    }));

    const insertViews = await supabase
      .from("kb_collection_views")
      .insert(rows)
      .select(COLLECTION_VIEW_SELECT)
      .order("position", { ascending: true });

    if (insertViews.error) {
      if (insertViews.error.code !== "23505") {
        return { state: null, error: insertViews.error.message };
      }
      const retryViews = await listCollectionViewRows(collectionRow.id);
      if ("error" in retryViews) return { state: null, error: retryViews.error };
      views = retryViews;
    } else {
      views = (insertViews.data ?? []) as CollectionViewRow[];
    }
  }

  const mappedViews = views.map(mapCollectionViewRow);
  for (const view of mappedViews) {
    if (view.sourceBlockId) legacyViewIdsByBlockId[view.sourceBlockId] = view.id;
  }

  const preferred = input.preferredViewId
    ? mappedViews.find((view) => view.id === input.preferredViewId)
    : null;
  const blockSource = mappedViews.find(
    (view) => view.sourceBlockId === input.blockId,
  );
  const activeView =
    preferred ?? blockSource ?? mappedViews[0] ?? null;

  if (!activeView) {
    return { state: null, error: "Не удалось создать вид коллекции" };
  }

  return {
    state: {
      collection: mapCollectionRow(collectionRow),
      views: mappedViews,
      activeViewId: activeView.id,
      legacyViewIdsByBlockId,
    },
    error: null,
  };
}

export async function updateKbCollection(input: {
  collectionId: string;
  title?: string;
  schemaJson?: string;
}): Promise<{ collection: KbCollection | null; error: string | null }> {
  const patch: { title?: string; schema_json?: Json } = {};
  if (input.title !== undefined) {
    patch.title = normalizeCollectionTitle(input.title);
  }
  if (input.schemaJson !== undefined) {
    patch.schema_json = schemaToJsonValue(
      parseCollectionSchemaJson(input.schemaJson),
    );
  }
  if (Object.keys(patch).length === 0) {
    return { collection: null, error: "Нет изменений" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_collections")
    .update(patch)
    .eq("id", input.collectionId)
    .select("id, page_id, collection_key, title, schema_json")
    .single();

  if (error) return { collection: null, error: error.message };
  return { collection: mapCollectionRow(data as CollectionRow), error: null };
}

export async function updateKbCollectionView(input: {
  viewId: string;
  name?: string;
  viewType?: KbCollectionView;
  visibleFieldIds?: KbCollectionVisibleFieldIds;
  fieldOrderIds?: KbCollectionVisibleFieldIds;
  filters?: KbCollectionFilter[];
}): Promise<{ view: KbCollectionViewConfig | null; error: string | null }> {
  const patch: {
    name?: string;
    view_type?: string;
    visible_field_ids?: Json | null;
    field_order_ids?: Json | null;
    filters_json?: Json;
  } = {};
  if (input.viewType !== undefined) {
    patch.view_type = normalizeCollectionViewType(input.viewType);
  }
  if (input.name !== undefined) {
    patch.name = normalizeCollectionViewName(
      input.name,
      normalizeCollectionViewType(input.viewType),
    );
  }
  if (input.visibleFieldIds !== undefined) {
    patch.visible_field_ids = collectionVisibleFieldIdsToJsonValue(
      input.visibleFieldIds,
    ) as unknown as Json | null;
  }
  if (input.fieldOrderIds !== undefined) {
    patch.field_order_ids = collectionVisibleFieldIdsToJsonValue(
      input.fieldOrderIds,
    ) as unknown as Json | null;
  }
  if (input.filters !== undefined) {
    patch.filters_json = collectionFiltersToJsonValue(
      input.filters,
    ) as Json;
  }
  if (Object.keys(patch).length === 0) {
    return { view: null, error: "Нет изменений" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_collection_views")
    .update(patch)
    .eq("id", input.viewId)
    .select(COLLECTION_VIEW_SELECT)
    .single();

  if (error) return { view: null, error: error.message };
  return { view: mapCollectionViewRow(data as CollectionViewRow), error: null };
}

export async function createKbCollectionView(input: {
  collectionId: string;
  viewType: KbCollectionView;
  name?: string;
}): Promise<{ view: KbCollectionViewConfig | null; error: string | null }> {
  const supabase = await createClient();
  const { data: accountId, error: accountError } = await supabase.rpc(
    "get_active_account_id",
  );
  if (accountError || !accountId) {
    return {
      view: null,
      error: accountError?.message ?? "Нет активного аккаунта",
    };
  }

  const existing = await listCollectionViewRows(input.collectionId);
  if ("error" in existing) return { view: null, error: existing.error };
  const position =
    existing.reduce((max, view) => Math.max(max, view.position), -1) + 1;
  const viewType = normalizeCollectionViewType(input.viewType);

  const { data, error } = await supabase
    .from("kb_collection_views")
    .insert({
      account_id: accountId,
      collection_id: input.collectionId,
      name: normalizeCollectionViewName(input.name, viewType),
      view_type: viewType,
      position,
    })
    .select(COLLECTION_VIEW_SELECT)
    .single();

  if (error) return { view: null, error: error.message };
  return { view: mapCollectionViewRow(data as CollectionViewRow), error: null };
}

export async function duplicateKbCollectionView(input: {
  viewId: string;
}): Promise<{ view: KbCollectionViewConfig | null; error: string | null }> {
  const supabase = await createClient();
  const { data: accountId, error: accountError } = await supabase.rpc(
    "get_active_account_id",
  );
  if (accountError || !accountId) {
    return {
      view: null,
      error: accountError?.message ?? "Нет активного аккаунта",
    };
  }

  const { data: source, error: sourceError } = await supabase
    .from("kb_collection_views")
    .select(COLLECTION_VIEW_SELECT)
    .eq("id", input.viewId)
    .single();
  if (sourceError || !source) {
    return { view: null, error: sourceError?.message ?? "Вид не найден" };
  }

  const existing = await listCollectionViewRows(source.collection_id);
  if ("error" in existing) return { view: null, error: existing.error };
  const position =
    existing.reduce((max, view) => Math.max(max, view.position), -1) + 1;

  const { data, error } = await supabase
    .from("kb_collection_views")
    .insert({
      account_id: accountId,
      collection_id: source.collection_id,
      name: `${source.name} копия`,
      view_type: source.view_type,
      visible_field_ids: source.visible_field_ids,
      field_order_ids: source.field_order_ids,
      filters_json: source.filters_json,
      position,
    })
    .select(COLLECTION_VIEW_SELECT)
    .single();

  if (error) return { view: null, error: error.message };
  return { view: mapCollectionViewRow(data as CollectionViewRow), error: null };
}

export async function deleteKbCollectionView(input: {
  viewId: string;
}): Promise<{
  views: KbCollectionViewConfig[];
  activeViewId: string | null;
  error: string | null;
}> {
  const supabase = await createClient();
  const { data: source, error: sourceError } = await supabase
    .from("kb_collection_views")
    .select(COLLECTION_VIEW_SELECT)
    .eq("id", input.viewId)
    .single();
  if (sourceError || !source) {
    return { views: [], activeViewId: null, error: sourceError?.message ?? "Вид не найден" };
  }

  const existing = await listCollectionViewRows(source.collection_id);
  if ("error" in existing) return { views: [], activeViewId: null, error: existing.error };
  if (existing.length <= 1) {
    return { views: existing.map(mapCollectionViewRow), activeViewId: source.id, error: "Нельзя удалить последний вид" };
  }

  const { error } = await supabase
    .from("kb_collection_views")
    .delete()
    .eq("id", input.viewId);
  if (error) return { views: [], activeViewId: null, error: error.message };

  const nextRows = existing.filter((view) => view.id !== input.viewId);
  const fallback =
    nextRows.find((view) => view.position > source.position) ?? nextRows.at(-1);
  return {
    views: nextRows.map(mapCollectionViewRow),
    activeViewId: fallback?.id ?? null,
    error: null,
  };
}

export async function createKbCollectionRecord(input: {
  parentPageId: string;
  collectionDbId?: string;
  schemaJson?: string;
  collectionId?: string;
  collectionTitle?: string;
}): Promise<{ id: string | null; slug: string | null; error: string | null }> {
  const collection = input.collectionDbId
    ? await getCollectionForSync(input.collectionDbId)
    : null;
  if (collection && "error" in collection) {
    return { id: null, slug: null, error: collection.error };
  }
  const schema = parseCollectionSchemaJson(
    collection ? collection.schemaJson : input.schemaJson,
  );
  const collectionId =
    collection?.collectionKey ?? input.collectionId ?? getPageCollectionId(input.parentPageId);
  const collectionTitle =
    collection?.title ?? input.collectionTitle ?? KB_COLLECTION_DEFAULT_TITLE;
  const context = {
    collectionId,
    collectionTitle,
    exclusive: true,
  };
  return createKbPage({
    parent_id: input.parentPageId,
    properties: collectionSchemaToProperties(schema, context),
  });
}

export async function syncKbCollectionRecords(input: {
  parentPageId: string;
  collectionDbId?: string;
  schemaJson?: string;
  collectionId?: string;
  collectionTitle?: string;
}): Promise<{ updated: number; error: string | null }> {
  const collection = input.collectionDbId
    ? await getCollectionForSync(input.collectionDbId)
    : null;
  if (collection && "error" in collection) {
    return { updated: 0, error: collection.error };
  }
  const schema = parseCollectionSchemaJson(
    collection ? collection.schemaJson : input.schemaJson,
  );
  const context = {
    collectionId:
      collection?.collectionKey ?? input.collectionId ?? getPageCollectionId(input.parentPageId),
    collectionTitle:
      collection?.title ?? input.collectionTitle ?? KB_COLLECTION_DEFAULT_TITLE,
    exclusive: true,
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select("id, properties")
    .eq("parent_id", input.parentPageId)
    .is("deleted_at", null)
    .order("position", { ascending: true });

  if (error) return { updated: 0, error: error.message };

  let updated = 0;
  for (const row of data ?? []) {
    const parsed = kbPropertiesSchema.safeParse(
      (row as { properties?: unknown }).properties ?? [],
    );
    const current = parsed.success ? parsed.data : [];
    const merged = mergeCollectionSchemaProperties(current, schema, context);
    if (!merged.changed) continue;

    const valid = kbPropertiesSchema.safeParse(merged.properties);
    if (!valid.success) {
      return {
        updated,
        error:
          valid.error.issues[0]?.message ??
          "Не удалось синхронизировать свойства коллекции",
      };
    }

    const { error: saveError } = await supabase.rpc("kb_save_page_properties", {
      p_id: row.id,
      p_properties: valid.data as unknown as never,
      p_force_new_version: false,
    } as never);
    if (saveError) return { updated, error: saveError.message };
    updated += 1;
  }

  return { updated, error: null };
}

async function getCollectionForSync(collectionId: string): Promise<
  | {
      collectionKey: string;
      title: string;
      schemaJson: Json;
    }
  | { error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_collections")
    .select("collection_key, title, schema_json")
    .eq("id", collectionId)
    .single();
  if (error || !data) return { error: error?.message ?? "Коллекция не найдена" };
  return {
    collectionKey: data.collection_key,
    title: data.title,
    schemaJson: data.schema_json,
  };
}

async function listCollectionViewRows(
  collectionId: string,
): Promise<CollectionViewRow[] | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_collection_views")
    .select(COLLECTION_VIEW_SELECT)
    .eq("collection_id", collectionId)
    .order("position", { ascending: true });

  if (error) return { error: error.message };
  return (data ?? []) as CollectionViewRow[];
}

function mapCollectionRow(row: CollectionRow): KbCollection {
  return {
    id: row.id,
    pageId: row.page_id,
    collectionKey: row.collection_key,
    title: normalizeCollectionTitle(row.title),
    schema: parseCollectionSchemaJson(row.schema_json),
  };
}

function mapCollectionViewRow(row: CollectionViewRow): KbCollectionViewConfig {
  const viewType = normalizeCollectionViewType(row.view_type);
  return {
    id: row.id,
    collectionId: row.collection_id,
    name: normalizeCollectionViewName(row.name, viewType),
    viewType,
    visibleFieldIds: parseVisibleFieldIdsJson(row.visible_field_ids),
    fieldOrderIds: parseVisibleFieldIdsJson(row.field_order_ids),
    filters: parseCollectionFiltersJson(row.filters_json),
    position: row.position,
    sourceBlockId: row.source_block_id,
  };
}

function normalizeLegacyBlocks(
  blocks: KbCollectionLegacyBlock[],
): KbCollectionLegacyBlock[] {
  const seen = new Set<string>();
  const normalized: KbCollectionLegacyBlock[] = [];
  for (const block of blocks) {
    if (!block.blockId || seen.has(block.blockId)) continue;
    const view = normalizeCollectionViewType(block.view);
    normalized.push({
      blockId: block.blockId,
      title: normalizeCollectionTitle(block.title),
      view,
      viewTitle: normalizeCollectionViewName(block.viewTitle, view),
      schemaJson: block.schemaJson || KB_COLLECTION_EMPTY_SCHEMA,
      visibleFieldIdsJson: block.visibleFieldIdsJson ?? "",
      fieldOrderIdsJson: block.fieldOrderIdsJson ?? "",
    });
    seen.add(block.blockId);
  }
  return normalized;
}

function pickCanonicalLegacyTitle(blocks: KbCollectionLegacyBlock[]): string {
  for (const block of blocks) {
    const title = normalizeCollectionTitle(block.title);
    if (title !== KB_COLLECTION_DEFAULT_TITLE) return title;
  }
  return KB_COLLECTION_DEFAULT_TITLE;
}

function pickCanonicalLegacySchema(
  blocks: KbCollectionLegacyBlock[],
): KbCollectionSchema {
  let best = parseCollectionSchemaJson(KB_COLLECTION_EMPTY_SCHEMA);
  for (const block of blocks) {
    const schema = parseCollectionSchemaJson(block.schemaJson);
    if (schema.fields.length > best.fields.length) best = schema;
  }
  return best;
}

function schemaToJsonValue(schema: KbCollectionSchema): Json {
  return JSON.parse(serializeCollectionSchema(schema)) as Json;
}
