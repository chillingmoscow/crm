-- ============================================================
-- 033_venues_default_legal_entity.sql
-- Привязка venue → default юрлицо + helper get_active_legal_entity_id().
--
-- См. docs/MERGE_PLAN.md §3.4 и §3.9.
-- ============================================================

-- 1. У каждого venue есть юрлицо по умолчанию (одно на venue).
--    nullable: существующие venues создавались до Этапа 2 без юрлица.
--    Онбординг и форма venue (Этап 2 UI) проставят это поле.
--    ON DELETE RESTRICT: нельзя удалить юрлицо, к которому привязан venue —
--    сначала переключите venue на другое юрлицо.
alter table public.venues
  add column if not exists default_legal_entity_id uuid
    references public.legal_entities(id) on delete restrict;

create index if not exists venues_default_legal_entity_idx
  on public.venues(default_legal_entity_id)
  where default_legal_entity_id is not null;

comment on column public.venues.default_legal_entity_id is
  'Юрлицо, под которым по умолчанию работает заведение. NULL до завершения '
  'онбординга юрлица.';

-- 2. Helper: активное юрлицо = default юрлицо активного venue.
--    Возвращает NULL, если у пользователя нет active membership.
--    SECURITY DEFINER + STABLE — паттерн совпадает с get_active_venue_id() (миграция 020).
create or replace function public.get_active_legal_entity_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.default_legal_entity_id
  from public.profiles p
  join public.venues v on v.id = p.active_venue_id
  where p.id = auth.uid()
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id  = auth.uid()
        and uvr.venue_id = p.active_venue_id
        and uvr.status   = 'active'
    );
$$;

comment on function public.get_active_legal_entity_id() is
  'Активное юрлицо (через активное venue). Используется в RLS финансового модуля.';
