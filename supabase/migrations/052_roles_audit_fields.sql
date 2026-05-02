-- ============================================================
-- roles audit fields
--
-- Добавляем created_at / updated_at / created_by / updated_by для
-- инфо-карточки «О должности» на детальной странице роли (Основное
-- таб, см. дизайн RbRH4).
--
-- Существующие системные роли получат created_at = now() (момент
-- применения миграции). Это норм — мы только добавляем поле, не
-- ломаем семантику. Owner-роль и пр. в production будут с этой
-- датой как «дата деплоя миграции», что приемлемо.
-- ============================================================

alter table public.roles
  add column if not exists created_at timestamptz default now() not null,
  add column if not exists updated_at timestamptz default now() not null,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- Trigger to auto-update updated_at + updated_by on row UPDATE.
-- auth.uid() returns null in service-role / non-authenticated contexts —
-- column allows null, so no failure там.
create or replace function public.tg_roles_set_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_roles_set_updated on public.roles;
create trigger trg_roles_set_updated
  before update on public.roles
  for each row execute function public.tg_roles_set_updated();

-- Trigger to auto-set created_by on INSERT (если ещё не задан).
create or replace function public.tg_roles_set_created()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_roles_set_created on public.roles;
create trigger trg_roles_set_created
  before insert on public.roles
  for each row execute function public.tg_roles_set_created();
