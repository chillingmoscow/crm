"use server";

import { createClient } from "@/lib/supabase/server";
import { createKbPage } from "@/lib/knowledge/pages";
import {
  KB_COLLECTION_DEFAULT_TITLE,
  KB_COLLECTION_EMPTY_SCHEMA,
  KB_COLLECTION_VIEW_LABELS,
  collectionColumnWidthsToJsonValue,
  collectionFiltersToJsonValue,
  collectionViewLayoutSettingsToJsonValue,
  collectionVisibleFieldIdsToJsonValue,
  collectionSchemaToProperties,
  getPageCollectionId,
  mergeCollectionSchemaProperties,
  normalizeCollectionTitle,
  normalizeCollectionViewDescription,
  normalizeCollectionViewIcon,
  normalizeCollectionViewName,
  normalizeCollectionViewTabDisplay,
  normalizeCollectionViewType,
  parseCollectionColumnWidthsJson,
  parseCollectionSchemaJson,
  parseCollectionFiltersJson,
  parseCollectionViewLayoutSettingsJson,
  parseVisibleFieldIdsJson,
  serializeCollectionSchema,
  type KbCollection,
  type KbCollectionColumnWidths,
  type KbCollectionFilter,
  type KbCollectionLegacyBlock,
  type KbCollectionSchema,
  type KbCollectionView,
  type KbCollectionViewConfig,
  type KbCollectionViewLayoutSettings,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
import {
  collectionGroupingToJsonValue,
  parseCollectionGroupingJson,
  type KbCollectionGrouping,
} from "@/lib/knowledge/collection-group";
import {
  collectionSortsToJsonValue,
  parseCollectionSortsJson,
  type KbCollectionSort,
} from "@/lib/knowledge/collection-sort";
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
  description: string | null;
  icon: string | null;
  tab_display: string | null;
  layout_settings_json: Json;
  view_type: string;
  visible_field_ids: Json | null;
  field_order_ids: Json | null;
  column_widths_json: Json;
  filters_json: Json;
  sorts_json: Json;
  grouping_json: Json;
  position: number;
  source_block_id: string | null;
};

const COLLECTION_VIEW_SELECT =
  "id, collection_id, name, description, icon, tab_display, layout_settings_json, view_type, visible_field_ids, field_order_ids, column_widths_json, filters_json, sorts_json, grouping_json, position, source_block_id" as const;

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

  const rows = (data ?? []).map(mapCollectionItemRow);

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

    const rows = legacyViews.map((legacy, index) => {
      const viewType = normalizeCollectionViewType(legacy.view);
      return {
        account_id: accountId,
        collection_id: collectionRow.id,
        name: normalizeCollectionViewName(legacy.viewTitle, viewType),
        view_type: viewType,
        layout_settings_json: collectionViewLayoutSettingsToJsonValue(
          parseCollectionViewLayoutSettingsJson(null, viewType),
        ) as Json,
        visible_field_ids: collectionVisibleFieldIdsToJsonValue(
          parseVisibleFieldIdsJson(legacy.visibleFieldIdsJson),
        ) as unknown as Json | null,
        field_order_ids: collectionVisibleFieldIdsToJsonValue(
          parseVisibleFieldIdsJson(legacy.fieldOrderIdsJson),
        ) as unknown as Json | null,
        filters_json: [],
        sorts_json: [],
        grouping_json: {},
        position: index,
        source_block_id: legacy.blockId,
      };
    });

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
  description?: string;
  icon?: string;
  tabDisplay?: string;
  layoutSettings?: KbCollectionViewLayoutSettings;
  viewType?: KbCollectionView;
  visibleFieldIds?: KbCollectionVisibleFieldIds;
  fieldOrderIds?: KbCollectionVisibleFieldIds;
  columnWidths?: KbCollectionColumnWidths;
  filters?: KbCollectionFilter[];
  sorts?: KbCollectionSort[];
  grouping?: KbCollectionGrouping | null;
  position?: number;
}): Promise<{ view: KbCollectionViewConfig | null; error: string | null }> {
  const patch: {
    name?: string;
    description?: string;
    icon?: string;
    tab_display?: string;
    layout_settings_json?: Json;
    view_type?: string;
    visible_field_ids?: Json | null;
    field_order_ids?: Json | null;
    column_widths_json?: Json;
    filters_json?: Json;
    sorts_json?: Json;
    grouping_json?: Json;
    position?: number;
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
  if (input.description !== undefined) {
    patch.description = normalizeCollectionViewDescription(input.description);
  }
  if (input.icon !== undefined) {
    patch.icon = normalizeCollectionViewIcon(
      input.icon,
      normalizeCollectionViewType(input.viewType),
    );
  }
  if (input.tabDisplay !== undefined) {
    patch.tab_display = normalizeCollectionViewTabDisplay(input.tabDisplay);
  }
  if (input.layoutSettings !== undefined) {
    patch.layout_settings_json = collectionViewLayoutSettingsToJsonValue(
      input.layoutSettings,
    ) as Json;
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
  if (input.columnWidths !== undefined) {
    patch.column_widths_json = collectionColumnWidthsToJsonValue(
      input.columnWidths,
    ) as Json;
  }
  if (input.filters !== undefined) {
    patch.filters_json = collectionFiltersToJsonValue(
      input.filters,
    ) as Json;
  }
  if (input.sorts !== undefined) {
    patch.sorts_json = collectionSortsToJsonValue(input.sorts) as Json;
  }
  if (input.grouping !== undefined) {
    patch.grouping_json = collectionGroupingToJsonValue(
      input.grouping,
    ) as Json;
  }
  if (input.position !== undefined) {
    patch.position = Math.max(0, Math.trunc(input.position));
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
      icon: normalizeCollectionViewIcon(null, viewType),
      tab_display: "text-icon",
      layout_settings_json: collectionViewLayoutSettingsToJsonValue(
        parseCollectionViewLayoutSettingsJson(null, viewType),
      ) as Json,
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
      description: source.description,
      icon: source.icon,
      tab_display: source.tab_display,
      layout_settings_json: source.layout_settings_json,
      view_type: source.view_type,
      visible_field_ids: source.visible_field_ids,
      field_order_ids: source.field_order_ids,
      column_widths_json: source.column_widths_json,
      filters_json: source.filters_json,
      sorts_json: source.sorts_json,
      grouping_json: source.grouping_json,
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

export async function restoreKbCollectionView(input: {
  view: KbCollectionViewConfig;
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

  const source = input.view;
  const viewType = normalizeCollectionViewType(source.viewType);
  const { data, error } = await supabase
    .from("kb_collection_views")
    .insert({
      account_id: accountId,
      collection_id: source.collectionId,
      name: normalizeCollectionViewName(source.name, viewType),
      description: normalizeCollectionViewDescription(source.description),
      icon: normalizeCollectionViewIcon(source.icon, viewType),
      tab_display: normalizeCollectionViewTabDisplay(source.tabDisplay),
      layout_settings_json: collectionViewLayoutSettingsToJsonValue(
        source.layoutSettings,
      ) as Json,
      view_type: viewType,
      visible_field_ids: collectionVisibleFieldIdsToJsonValue(
        source.visibleFieldIds,
      ) as Json | null,
      field_order_ids: collectionVisibleFieldIdsToJsonValue(
        source.fieldOrderIds,
      ) as Json | null,
      column_widths_json: collectionColumnWidthsToJsonValue(
        source.columnWidths,
      ) as Json,
      filters_json: collectionFiltersToJsonValue(source.filters) as Json,
      sorts_json: collectionSortsToJsonValue(source.sorts) as Json,
      grouping_json: collectionGroupingToJsonValue(source.grouping) as Json,
      position: source.position,
    })
    .select(COLLECTION_VIEW_SELECT)
    .single();

  if (error) return { view: null, error: error.message };
  return { view: mapCollectionViewRow(data as CollectionViewRow), error: null };
}

export async function createKbCollectionRecord(input: {
  parentPageId: string;
  collectionDbId?: string;
  schemaJson?: string;
  collectionId?: string;
  collectionTitle?: string;
}): Promise<{
  id: string | null;
  slug: string | null;
  row: KbCollectionItem | null;
  error: string | null;
}> {
  const collection = input.collectionDbId
    ? await getCollectionForSync(input.collectionDbId)
    : null;
  if (collection && "error" in collection) {
    return { id: null, slug: null, row: null, error: collection.error };
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
  const created = await createKbPage({
    parent_id: input.parentPageId,
    properties: collectionSchemaToProperties(schema, context),
  });
  if (created.error || !created.id) {
    return {
      id: created.id,
      slug: created.slug,
      row: null,
      error: created.error,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select(
      "id, slug, title, icon, icon_color, cover_url, plain_text, properties, position, updated_at",
    )
    .eq("id", created.id)
    .single();

  if (error) {
    return {
      id: created.id,
      slug: created.slug,
      row: null,
      error: error.message,
    };
  }

  return {
    id: created.id,
    slug: created.slug,
    row: mapCollectionItemRow(data),
    error: null,
  };
}

export async function updateKbCollectionRecordTitle(input: {
  pageId: string;
  title: string;
}): Promise<{ title: string | null; error: string | null }> {
  const title = input.title.trim() || "Без названия";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .update({ title })
    .eq("id", input.pageId)
    .select("title")
    .single();

  if (error) return { title: null, error: error.message };
  return { title: data.title, error: null };
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

function mapCollectionItemRow(row: {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
  cover_url: string | null;
  plain_text: string | null;
  properties?: unknown;
  position: number | null;
  updated_at: string | null;
}): KbCollectionItem {
  const parsed = kbPropertiesSchema.safeParse(row.properties ?? []);
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
  };
}

function mapCollectionViewRow(row: CollectionViewRow): KbCollectionViewConfig {
  const viewType = normalizeCollectionViewType(row.view_type);
  return {
    id: row.id,
    collectionId: row.collection_id,
    name: normalizeCollectionViewName(row.name, viewType),
    description: normalizeCollectionViewDescription(row.description),
    icon: normalizeCollectionViewIcon(row.icon, viewType),
    tabDisplay: normalizeCollectionViewTabDisplay(row.tab_display),
    layoutSettings: parseCollectionViewLayoutSettingsJson(
      row.layout_settings_json,
      viewType,
    ),
    viewType,
    visibleFieldIds: parseVisibleFieldIdsJson(row.visible_field_ids),
    fieldOrderIds: parseVisibleFieldIdsJson(row.field_order_ids),
    columnWidths: parseCollectionColumnWidthsJson(row.column_widths_json),
    filters: parseCollectionFiltersJson(row.filters_json),
    sorts: parseCollectionSortsJson(row.sorts_json),
    grouping: parseCollectionGroupingJson(row.grouping_json),
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
