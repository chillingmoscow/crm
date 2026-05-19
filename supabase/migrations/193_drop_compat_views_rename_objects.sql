-- ============================================================
-- 193_drop_compat_views_rename_objects.sql
-- Этап 4 Pass 4.4 (финал) — снимаем оставшиеся compat-views и
-- приводим имена констрейнтов/индексов/триггеров/политик на
-- переименованных таблицах к доменной модели (косметика; функции
-- touch-триггеров — generic-хелперы, общие с др. таблицами, не трогаем).
-- Код/seed/тесты на новые имена с 4.2/192 (0 ссылок на вьюхи).
-- inventory_result_* и их объекты сохраняются (решение по Этапу 4).
-- ============================================================

drop view public.inventory_products;
drop view public.inventory_product_groups;
drop view public.inventory_documents;
drop view public.inventory_stores;

ALTER TABLE public.document_items RENAME CONSTRAINT inventory_document_items_account_id_fkey TO document_items_account_id_fkey;
ALTER TABLE public.document_items RENAME CONSTRAINT inventory_document_items_document_id_fkey TO document_items_document_id_fkey;
ALTER TABLE public.document_items RENAME CONSTRAINT inventory_document_items_document_tenant_fkey TO document_items_document_tenant_fkey;
ALTER TABLE public.document_items RENAME CONSTRAINT inventory_document_items_excluded_by_fkey TO document_items_excluded_by_fkey;
ALTER TABLE public.document_items RENAME CONSTRAINT inventory_document_items_pkey TO document_items_pkey;
ALTER TABLE public.document_items RENAME CONSTRAINT inventory_document_items_result_comment_updated_by_fkey TO document_items_result_comment_updated_by_fkey;
ALTER TABLE public.document_items RENAME CONSTRAINT inventory_document_items_unique TO document_items_unique;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_account_id_fkey TO documents_account_id_fkey;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_account_id_id_key TO documents_account_id_id_key;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_assigned_to_fkey TO documents_assigned_to_fkey;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_external_unique TO documents_external_unique;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_pkey TO documents_pkey;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_results_finalized_by_fkey TO documents_results_finalized_by_fkey;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_results_reopened_by_fkey TO documents_results_reopened_by_fkey;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_store_id_fkey TO documents_store_id_fkey;
ALTER TABLE public.documents RENAME CONSTRAINT inventory_documents_submitted_by_fkey TO documents_submitted_by_fkey;
ALTER TABLE public.ingredient_groups RENAME CONSTRAINT inventory_product_groups_account_id_fkey TO ingredient_groups_account_id_fkey;
ALTER TABLE public.ingredient_groups RENAME CONSTRAINT inventory_product_groups_account_id_id_key TO ingredient_groups_account_id_id_key;
ALTER TABLE public.ingredient_groups RENAME CONSTRAINT inventory_product_groups_external_unique TO ingredient_groups_external_unique;
ALTER TABLE public.ingredient_groups RENAME CONSTRAINT inventory_product_groups_parent_group_id_fkey TO ingredient_groups_parent_group_id_fkey;
ALTER TABLE public.ingredient_groups RENAME CONSTRAINT inventory_product_groups_pkey TO ingredient_groups_pkey;
ALTER TABLE public.ingredient_groups RENAME CONSTRAINT inventory_product_groups_primary_image_file_id_fkey TO ingredient_groups_primary_image_file_id_fkey;
ALTER TABLE public.ingredients RENAME CONSTRAINT inventory_products_account_id_fkey TO ingredients_account_id_fkey;
ALTER TABLE public.ingredients RENAME CONSTRAINT inventory_products_account_id_id_key TO ingredients_account_id_id_key;
ALTER TABLE public.ingredients RENAME CONSTRAINT inventory_products_external_unique TO ingredients_external_unique;
ALTER TABLE public.ingredients RENAME CONSTRAINT inventory_products_group_id_fkey TO ingredients_group_id_fkey;
ALTER TABLE public.ingredients RENAME CONSTRAINT inventory_products_pkey TO ingredients_pkey;
ALTER TABLE public.ingredients RENAME CONSTRAINT inventory_products_primary_image_file_id_fkey TO ingredients_primary_image_file_id_fkey;
ALTER TABLE public.stores RENAME CONSTRAINT inventory_stores_account_id_fkey TO stores_account_id_fkey;
ALTER TABLE public.stores RENAME CONSTRAINT inventory_stores_account_id_id_key TO stores_account_id_id_key;
ALTER TABLE public.stores RENAME CONSTRAINT inventory_stores_external_unique TO stores_external_unique;
ALTER TABLE public.stores RENAME CONSTRAINT inventory_stores_local_venue_id_fkey TO stores_local_venue_id_fkey;
ALTER TABLE public.stores RENAME CONSTRAINT inventory_stores_pkey TO stores_pkey;

ALTER INDEX public.inventory_document_items_document_idx RENAME TO document_items_document_idx;
ALTER INDEX public.inventory_document_items_result_flags_idx RENAME TO document_items_result_flags_idx;
ALTER INDEX public.inventory_documents_account_idx RENAME TO documents_account_idx;
ALTER INDEX public.inventory_documents_assigned_idx RENAME TO documents_assigned_idx;
ALTER INDEX public.inventory_documents_kind_idx RENAME TO documents_kind_idx;
ALTER INDEX public.inventory_documents_status_idx RENAME TO documents_status_idx;
ALTER INDEX public.inventory_product_groups_account_idx RENAME TO ingredient_groups_account_idx;
ALTER INDEX public.inventory_product_groups_image_idx RENAME TO ingredient_groups_image_idx;
ALTER INDEX public.inventory_products_account_idx RENAME TO ingredients_account_idx;
ALTER INDEX public.inventory_products_active_idx RENAME TO ingredients_active_idx;
ALTER INDEX public.inventory_products_group_idx RENAME TO ingredients_group_idx;
ALTER INDEX public.inventory_products_image_idx RENAME TO ingredients_image_idx;
ALTER INDEX public.inventory_products_kind_idx RENAME TO ingredients_kind_idx;
ALTER INDEX public.inventory_stores_account_idx RENAME TO stores_account_idx;

ALTER TRIGGER trg_inventory_document_items_touch_updated ON public.document_items RENAME TO trg_document_items_touch_updated;
ALTER TRIGGER trg_inventory_documents_touch_updated ON public.documents RENAME TO trg_documents_touch_updated;
ALTER TRIGGER trg_inventory_product_groups_touch_updated ON public.ingredient_groups RENAME TO trg_ingredient_groups_touch_updated;
ALTER TRIGGER trg_inventory_products_touch_updated ON public.ingredients RENAME TO trg_ingredients_touch_updated;
ALTER TRIGGER trg_inventory_stores_touch_updated ON public.stores RENAME TO trg_stores_touch_updated;

ALTER POLICY "inventory_document_items_select" ON public.document_items RENAME TO "document_items_select";
ALTER POLICY "inventory_document_items_write_manage" ON public.document_items RENAME TO "document_items_write_manage";
ALTER POLICY "inventory_documents_delete" ON public.documents RENAME TO "documents_delete";
ALTER POLICY "inventory_documents_insert" ON public.documents RENAME TO "documents_insert";
ALTER POLICY "inventory_documents_select" ON public.documents RENAME TO "documents_select";
ALTER POLICY "inventory_documents_update_manage" ON public.documents RENAME TO "documents_update_manage";
ALTER POLICY "inventory_product_groups_select" ON public.ingredient_groups RENAME TO "ingredient_groups_select";
ALTER POLICY "inventory_product_groups_write" ON public.ingredient_groups RENAME TO "ingredient_groups_write";
ALTER POLICY "inventory_products_select" ON public.ingredients RENAME TO "ingredients_select";
ALTER POLICY "inventory_products_write" ON public.ingredients RENAME TO "ingredients_write";
ALTER POLICY "inventory_stores_select" ON public.stores RENAME TO "stores_select";
ALTER POLICY "inventory_stores_write" ON public.stores RENAME TO "stores_write";
