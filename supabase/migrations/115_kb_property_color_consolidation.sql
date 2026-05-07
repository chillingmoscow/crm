-- ============================================================
-- 115_kb_property_color_consolidation.sql
-- Унификация второй устаревшей палитры — `optionColors` у select /
-- multi-select свойств. Раньше там жил отдельный 10-цветный набор
-- (KbPropertyColor: stone/amber/sky/teal/indigo + …), не совпадающий
-- ни с BlockNote'ом, ни с iconColor'ами.
--
-- Теперь весь app использует единую Notion-10 палитру (см.
-- src/lib/palette.ts → PaletteColor). Маппинг для backfill'а:
--   stone  → gray
--   amber  → brown
--   sky    → blue
--   teal   → green   (как в мигр. 113)
--   indigo → purple  (как в мигр. 113)
--
-- Затрагивает `kb_pages.properties[].optionColors[*]` — это map
-- {option_string: color_name}. Параллельно — `kb_templates.properties`
-- (тот же тип). UI безопасен и до миграции: `normalizePaletteColor` в
-- palette.ts маппит легаси-значения на чтении.
-- ============================================================

-- Helper-функция: рекурсивно мапит legacy → canonical в jsonb значении
-- color name. Возвращает входное значение если не legacy.
create or replace function pg_temp.kb_palette_canonical(v jsonb)
returns jsonb
language sql
immutable
as $$
  select case (v #>> '{}')
    when 'stone'  then '"gray"'::jsonb
    when 'amber'  then '"brown"'::jsonb
    when 'sky'    then '"blue"'::jsonb
    when 'teal'   then '"green"'::jsonb
    when 'indigo' then '"purple"'::jsonb
    else v
  end
$$;

-- ── kb_pages.properties[].optionColors ──────────────────────
do $$
declare
  v_row record;
  v_props jsonb;
begin
  for v_row in
    select id, properties
      from public.kb_pages
     where properties::text ~ '"(stone|amber|sky|teal|indigo)"'
  loop
    select jsonb_agg(
      case
        when prop ? 'optionColors'
          and jsonb_typeof(prop->'optionColors') = 'object'
        then jsonb_set(
          prop, '{optionColors}',
          (
            select coalesce(jsonb_object_agg(k, pg_temp.kb_palette_canonical(val)), '{}'::jsonb)
            from jsonb_each(prop->'optionColors') as oc(k, val)
          )
        )
        else prop
      end
    )
    into v_props
    from jsonb_array_elements(v_row.properties) as prop;

    if v_props is distinct from v_row.properties then
      update public.kb_pages set properties = v_props where id = v_row.id;
    end if;
  end loop;
end$$;

-- ── kb_templates.properties[].optionColors (если таблица существует) ─
-- Шаблоны хранят такой же `KbProperty[]`. Защищаемся от отсутствия
-- таблицы через to_regclass — на случай если миграция накатывается на
-- среды без kb_templates.
do $$
declare
  v_row record;
  v_props jsonb;
begin
  if to_regclass('public.kb_templates') is null then
    return;
  end if;
  for v_row in
    execute $q$
      select id, properties
        from public.kb_templates
       where properties::text ~ '"(stone|amber|sky|teal|indigo)"'
    $q$
  loop
    select jsonb_agg(
      case
        when prop ? 'optionColors'
          and jsonb_typeof(prop->'optionColors') = 'object'
        then jsonb_set(
          prop, '{optionColors}',
          (
            select coalesce(jsonb_object_agg(k, pg_temp.kb_palette_canonical(val)), '{}'::jsonb)
            from jsonb_each(prop->'optionColors') as oc(k, val)
          )
        )
        else prop
      end
    )
    into v_props
    from jsonb_array_elements(v_row.properties) as prop;

    if v_props is distinct from v_row.properties then
      execute 'update public.kb_templates set properties = $1 where id = $2'
        using v_props, v_row.id;
    end if;
  end loop;
end$$;
