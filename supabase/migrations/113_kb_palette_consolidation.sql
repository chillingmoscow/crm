-- ============================================================
-- 113_kb_palette_consolidation.sql
-- Унификация KB-палитры: 13 цветов → 10 (Notion-style).
--
-- В предыдущей версии picker'а (см. src/lib/knowledge/icons.ts до этой
-- итерации) у KB-иконок было 13 цветов, включая lime/teal/cyan/indigo.
-- BlockNote /color picker и общая палитра приложения работают с 10
-- цветами Notion (default/gray/brown/orange/yellow/green/blue/purple/
-- pink/red). Сжимаем KB-палитру до того же набора, чтобы цвет иконок,
-- цвет текста в редакторе и цвет тинт-фона использовали один источник
-- правды (см. src/lib/palette.ts).
--
-- Маппинг для backfill'а (ближайший Notion-цвет):
--   lime   → green
--   teal   → green
--   cyan   → blue
--   indigo → purple
--
-- UI безопасен и до миграции: `normalizePaletteColor` в palette.ts делает
-- тот же маппинг при чтении. Эта миграция чистит данные постфактум.
--
-- ВАЖНО: НЕ трогаем `properties[].options[].color` — там используется
-- ОТДЕЛЬНАЯ палитра `KbPropertyColor` (stone/amber/sky/teal/indigo для
-- select-option chip'ов). Только `kb_pages.icon_color` и
-- `kb_pages.properties[].iconColor`.
-- ============================================================

-- 1. Top-level icon_color на kb_pages.
update public.kb_pages
   set icon_color = case icon_color
     when 'lime'   then 'green'
     when 'teal'   then 'green'
     when 'cyan'   then 'blue'
     when 'indigo' then 'purple'
     else icon_color end
 where icon_color in ('lime', 'teal', 'cyan', 'indigo');

-- 2. property.iconColor внутри jsonb массива kb_pages.properties.
--    properties — `KbProperty[]` (см. src/types/knowledge.ts). Каждая
--    property может иметь `iconColor`. options[].color остаётся как есть
--    (другая палитра).
do $$
declare
  v_row record;
  v_new_props jsonb;
begin
  for v_row in
    select id, properties
      from public.kb_pages
     where properties::text ~ '"iconColor"\s*:\s*"(lime|teal|cyan|indigo)"'
  loop
    select jsonb_agg(
      case
        when prop ? 'iconColor' and (prop->>'iconColor') in ('lime','teal','cyan','indigo')
          then jsonb_set(prop, '{iconColor}',
            to_jsonb(case prop->>'iconColor'
              when 'lime'   then 'green'
              when 'teal'   then 'green'
              when 'cyan'   then 'blue'
              when 'indigo' then 'purple' end))
        else prop
      end
    )
    into v_new_props
    from jsonb_array_elements(v_row.properties) as prop;

    if v_new_props is distinct from v_row.properties then
      update public.kb_pages set properties = v_new_props where id = v_row.id;
    end if;
  end loop;
end$$;

-- CHECK-constraint на kb_pages.icon_color НАМЕРЕННО не добавляем здесь.
-- Сделаем follow-up'ом (115_kb_palette_constraint.sql) после одного
-- deploy-цикла когда логи подтвердят отсутствие легаси-значений
-- в новых записях.
