-- ============================================================
-- 389_dish_photos_quickresto.sql
-- Этап 4: фото блюд из Quick Resto сами приезжают в каталог.
-- Дизайн: docs/superpowers/specs/2026-11-24-counterparties-suppliers-design.md §7.
--
--   * ingredients: откуда фото (руками / из Quick Resto), ссылка фото Quick
--     Resto при прошлой проверке, когда и на какой версии блюда проверяли,
--     метка захвата очередью;
--   * integration_connections.dish_photos_paused_until — пауза очереди
--     аккаунта после сбоя входа в бэк-офис или ограничения частоты;
--   * account_files.uploaded_by может быть пустым: файл скачала система;
--   * claim_dish_photo_checks() — пачка блюд одного аккаунта для проверки,
--     только для service_role;
--   * ротация фонового обработчика — 11 полос (новая полоса 10 — фото блюд).
-- ============================================================

alter table public.ingredients
  add column photo_source text,
  add column quickresto_photo_url text,
  add column quickresto_photo_checked_at timestamptz,
  add column quickresto_photo_checked_version integer,
  add column quickresto_photo_claimed_at timestamptz,
  add constraint ingredients_photo_source_check
    check (photo_source is null or photo_source in ('manual', 'quickresto'));

comment on column public.ingredients.photo_source is
  'Откуда фото позиции: manual — загружено руками (синхронизация не трогает), quickresto — копия из Quick Resto.';
comment on column public.ingredients.quickresto_photo_url is
  'Ссылка фото блюда в Quick Resto при прошлой проверке. Снятое руками фото не возвращается, пока ссылка не сменится.';

-- Всё, что уже есть, загружено руками.
update public.ingredients
   set photo_source = 'manual'
 where primary_image_file_id is not null;

create index ingredients_dish_photo_check_idx
  on public.ingredients (account_id, quickresto_photo_checked_at nulls first)
  where kind = 'dish' and archived_at is null;

alter table public.integration_connections
  add column dish_photos_paused_until timestamptz;

alter table public.account_files
  alter column uploaded_by drop not null;

-- Пачка блюд одного аккаунта, которым пора проверить фото: ни разу не
-- проверяли, проверяли больше суток назад или сменилась версия блюда.
-- Захват — метка claimed_at (10 минут): параллельный ход их не возьмёт.
create or replace function public.claim_dish_photo_checks(p_limit integer)
returns table (
  id uuid,
  account_id uuid,
  external_id text,
  external_version integer,
  primary_image_file_id uuid,
  photo_source text,
  quickresto_photo_url text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account uuid;
begin
  -- Аккаунт, чьё блюдо дольше всех ждёт проверки (ни разу не проверенные —
  -- первыми): ни один аккаунт не забирает очередь себе навсегда.
  select i.account_id
    into v_account
    from public.ingredients i
    join public.integration_connections ic
      on ic.account_id = i.account_id
     and ic.provider = 'quickresto'
     and ic.status = 'active'
     and ic.backoffice_login is not null
     and (ic.dish_photos_paused_until is null or ic.dish_photos_paused_until <= now())
   where i.kind = 'dish'
     and i.archived_at is null
     and i.external_id ~ '^[0-9]+$'
     and (i.quickresto_photo_claimed_at is null or i.quickresto_photo_claimed_at < now() - interval '10 minutes')
     and (
       i.quickresto_photo_checked_at is null
       or i.quickresto_photo_checked_at < now() - interval '1 day'
       or i.quickresto_photo_checked_version is distinct from i.external_version
     )
   order by i.quickresto_photo_checked_at nulls first
   limit 1;

  if v_account is null then
    return;
  end if;

  return query
  with due as (
    select i.id
      from public.ingredients i
     where i.account_id = v_account
       and i.kind = 'dish'
       and i.archived_at is null
       and i.external_id ~ '^[0-9]+$'
       and (i.quickresto_photo_claimed_at is null or i.quickresto_photo_claimed_at < now() - interval '10 minutes')
       and (
         i.quickresto_photo_checked_at is null
         or i.quickresto_photo_checked_at < now() - interval '1 day'
         or i.quickresto_photo_checked_version is distinct from i.external_version
       )
     order by i.quickresto_photo_checked_at nulls first, i.id
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.ingredients i
     set quickresto_photo_claimed_at = now()
    from due
   where i.id = due.id
  returning i.id, i.account_id, i.external_id, i.external_version,
            i.primary_image_file_id, i.photo_source, i.quickresto_photo_url;
end;
$$;

revoke all on function public.claim_dish_photo_checks(integer) from public, anon, authenticated;
grant execute on function public.claim_dish_photo_checks(integer) to service_role;

-- Ротация фонового обработчика: полоса 10 — фото блюд. Тело — из 293, меняется
-- только число полос.
create or replace function public.sales_next_worker_lane()
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into private.sales_worker_rotation as rotation(id, lane)
  values (true, 0)
  on conflict (id) do update set lane = (rotation.lane + 1) % 11
  returning lane
$$;

revoke all on function public.sales_next_worker_lane() from public, anon, authenticated;
grant execute on function public.sales_next_worker_lane() to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.claim_dish_photo_checks(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_dish_photo_checks(integer)', 'EXECUTE')
  then
    raise exception 'Права на очередь фото блюд не сняты: применяйте миграцию от владельца (supabase_admin)';
  end if;
  if has_function_privilege('anon', 'public.sales_next_worker_lane()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.sales_next_worker_lane()', 'EXECUTE')
  then
    raise exception 'Ротация обработчика доступна пользователям: применяйте миграцию от владельца (supabase_admin)';
  end if;
  if not has_function_privilege('service_role', 'public.claim_dish_photo_checks(integer)', 'EXECUTE') then
    raise exception 'Нет права service_role на очередь фото блюд';
  end if;
end
$$;
