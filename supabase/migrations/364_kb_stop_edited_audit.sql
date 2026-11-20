-- ============================================================
-- 364_kb_stop_edited_audit.sql
-- Правки страниц базы знаний больше не пишутся в общий журнал.
--
-- 180 добавила в kb_upsert_page_version_session запись kb_page.edited
-- в audit_logs на каждую новую 15-минутную сессию правок. На практике
-- это основная масса строк журнала и шум в ленте: владелец решил, что
-- журналу правки контента не нужны. Детальная история правок остаётся
-- во «Истории версий» страницы (kb_page_versions) и в ленте обновлений
-- страницы (kb_list_page_updates берёт kb_page.edited из версий, audit-
-- ветку для этого кода 180 уже исключила).
--
-- Структурные события (создание, переименование, перемещение,
-- удаление, восстановление, блокировка, «обязательно к прочтению»)
-- остаются — их пишут триггеры 074 и последующих миграций.
-- Уже записанные kb_page.edited не трогаем.
--
-- Тело — копия из 180 без ветки log_audit; search_path по конвенции
-- (CREATE OR REPLACE сбрасывает атрибуты).
-- ============================================================

create or replace function public.kb_upsert_page_version_session(
  p_page_id uuid,
  p_account_id uuid,
  p_title text,
  p_icon text,
  p_icon_color text,
  p_content jsonb,
  p_plain_text text,
  p_properties jsonb,
  p_created_by uuid,
  p_change_kinds text[],
  p_force_new_version boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_latest public.kb_page_versions%rowtype;
  v_version integer;
  v_change_kinds text[];
begin
  select *
    into v_latest
    from public.kb_page_versions
   where page_id = p_page_id
   order by version_number desc
   limit 1
   for update;

  if found
     and not p_force_new_version
     and v_latest.created_by is not distinct from p_created_by
     and coalesce(v_latest.updated_at, v_latest.created_at) >= now() - interval '15 minutes'
     and not exists (
       select 1
         from public.kb_page_reads r
        where r.page_id = p_page_id
          and r.read_version = v_latest.version_number
     )
  then
    select coalesce(array_agg(distinct kind order by kind), '{}'::text[])
      into v_change_kinds
      from unnest(coalesce(v_latest.change_kinds, '{}'::text[]) || coalesce(p_change_kinds, '{}'::text[])) as kind;

    update public.kb_page_versions
       set title = p_title,
           icon = p_icon,
           icon_color = p_icon_color,
           content = p_content,
           plain_text = coalesce(p_plain_text, ''),
           text_length = char_length(coalesce(p_plain_text, '')),
           properties = p_properties,
           updated_at = now(),
           change_kinds = v_change_kinds
     where id = v_latest.id
     returning version_number into v_version;

    -- Fold-ветка: правка свёрнута в существующую сессию — НЕ эмитим
    -- audit (иначе тот самый шум).
    return v_version;
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_version
    from public.kb_page_versions
   where page_id = p_page_id;

  insert into public.kb_page_versions (
    page_id,
    account_id,
    version_number,
    title,
    icon,
    icon_color,
    content,
    plain_text,
    text_length,
    properties,
    created_by,
    updated_at,
    change_kinds
  ) values (
    p_page_id,
    p_account_id,
    v_version,
    p_title,
    p_icon,
    p_icon_color,
    p_content,
    coalesce(p_plain_text, ''),
    char_length(coalesce(p_plain_text, '')),
    p_properties,
    p_created_by,
    now(),
    coalesce(p_change_kinds, '{}'::text[])
  );

  return v_version;
end;
$$;

comment on function public.kb_upsert_page_version_session(
  uuid, uuid, text, text, text, jsonb, text, jsonb, uuid, text[], boolean
) is
  'Сворачивает autosave в 15-минутную версию-сессию (119/120). '
  'В общий журнал правки не пишет (364): история правок — в версиях.';
