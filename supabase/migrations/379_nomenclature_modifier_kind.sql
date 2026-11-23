-- ============================================================
-- 379_nomenclature_modifier_kind.sql
-- Модификаторы блюд Quick Resto как вид номенклатуры.
-- Нужны правилам допродаж по подразделениям: правило выбирает
-- модификатор или группу модификаторов из каталога.
--
-- Новое значение enum не используется в этой же миграции (так требует
-- PostgreSQL). Типы связей — text с check, поэтому их расширяем здесь же.
-- ============================================================

alter type public.nomenclature_kind_enum add value if not exists 'modifier';

alter table public.external_entity_links
  drop constraint if exists external_entity_links_entity_type_check;

alter table public.external_entity_links
  add constraint external_entity_links_entity_type_check check (
    entity_type = any (array[
      'venue', 'role', 'staff',
      'ingredient', 'ingredient_group',
      'dish', 'dish_group',
      'semi_finished', 'semi_finished_group',
      'modifier', 'modifier_group',
      'store', 'inventory_document'
    ]::text[])
  );
