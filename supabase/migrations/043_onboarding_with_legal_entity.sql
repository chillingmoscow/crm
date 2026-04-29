-- ============================================================
-- 043_onboarding_with_legal_entity.sql
--
-- Обновлённый complete_owner_onboarding(): теперь принимает данные
-- юрлица и создаёт legal_entity, прокидывая venues.default_legal_entity_id.
-- См. docs/MERGE_PLAN.md §3.4 (раздел про complete_owner_onboarding).
--
-- Идемпотентность: если account/legal_entity/venue уже существуют для
-- этого owner — функция не создаёт дубликатов, возвращает существующие
-- IDs. Это гарантия для повторных вызовов и для миграций, которые могут
-- проигрываться повторно на той же БД.
-- ============================================================

-- Старая сигнатура из 026 удаляется: PostgreSQL не разрешает изменять
-- список параметров через CREATE OR REPLACE.
drop function if exists public.complete_owner_onboarding(
  text, text, text, public.venue_type, text, text, text, text, text, jsonb
);

create or replace function public.complete_owner_onboarding(
  -- Account
  p_account_name  text,
  p_account_logo  text,

  -- Legal entity (new in stage 2)
  p_legal_name    text,
  p_legal_form    public.legal_form_enum,
  p_legal_inn     text,

  -- Venue
  p_venue_name    text,
  p_venue_type    public.venue_type,
  p_venue_address text,
  p_venue_phone   text,
  p_venue_website text     default '',
  p_currency      text     default 'RUB',
  p_timezone      text     default 'Europe/Moscow',
  p_working_hours jsonb    default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id        uuid;
  v_legal_entity_id   uuid;
  v_venue_id          uuid;
  v_owner_role_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- ──────────────────────────────────────────────
  -- 1. Account (один на owner — берём существующий, если есть).
  -- ──────────────────────────────────────────────
  select id into v_account_id
  from public.accounts
  where owner_id = auth.uid()
  limit 1;

  if v_account_id is null then
    insert into public.accounts (name, logo_url, owner_id)
    values (p_account_name, p_account_logo, auth.uid())
    returning id into v_account_id;
  end if;

  -- ──────────────────────────────────────────────
  -- 2. Legal entity (берём первый существующий или создаём).
  -- ──────────────────────────────────────────────
  select id into v_legal_entity_id
  from public.legal_entities
  where account_id = v_account_id
  order by created_at asc
  limit 1;

  if v_legal_entity_id is null then
    insert into public.legal_entities (
      account_id, name, legal_form, inn, created_by
    ) values (
      v_account_id,
      p_legal_name,
      p_legal_form,
      nullif(trim(p_legal_inn), ''),
      auth.uid()
    )
    returning id into v_legal_entity_id;
  end if;

  -- ──────────────────────────────────────────────
  -- 3. Venue (если у owner ещё нет venue в этом account — создаём).
  -- ──────────────────────────────────────────────
  select v.id into v_venue_id
  from public.venues v
  where v.account_id = v_account_id
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.venue_id = v.id
        and uvr.user_id  = auth.uid()
    )
  limit 1;

  if v_venue_id is null then
    insert into public.venues (
      account_id, default_legal_entity_id,
      name, type, address, phone, website,
      currency, timezone, working_hours
    ) values (
      v_account_id, v_legal_entity_id,
      p_venue_name, p_venue_type,
      p_venue_address, p_venue_phone,
      nullif(trim(p_venue_website), ''),
      p_currency, p_timezone, p_working_hours
    )
    returning id into v_venue_id;
  else
    -- Если venue уже был, но без юрлица — проставим default_legal_entity_id.
    update public.venues
    set default_legal_entity_id = v_legal_entity_id
    where id = v_venue_id
      and default_legal_entity_id is null;
  end if;

  -- ──────────────────────────────────────────────
  -- 4. Owner-membership (привязка к venue).
  -- ──────────────────────────────────────────────
  select id into v_owner_role_id
  from public.roles
  where code = 'owner' and account_id is null;

  insert into public.user_venue_roles (user_id, venue_id, role_id)
  values (auth.uid(), v_venue_id, v_owner_role_id)
  on conflict (user_id, venue_id) do nothing;

  -- ──────────────────────────────────────────────
  -- 5. Активное venue.
  -- ──────────────────────────────────────────────
  update public.profiles
  set active_venue_id = v_venue_id
  where id = auth.uid()
    and active_venue_id is null;

  return jsonb_build_object(
    'account_id',       v_account_id,
    'legal_entity_id',  v_legal_entity_id,
    'venue_id',         v_venue_id
  );
end;
$$;

comment on function public.complete_owner_onboarding(
  text, text, text, public.legal_form_enum, text,
  text, public.venue_type, text, text, text, text, text, jsonb
) is
  'Создаёт цепочку owner → account → legal_entity → venue + назначает '
  'роль owner и активное venue. Идемпотентна: повторный вызов возвращает '
  'существующие IDs без ошибок.';
