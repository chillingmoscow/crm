-- ============================================================
-- 181_kb_view_version_history_permission.sql
-- Новый permission `kb.view_version_history` (фидбек №1).
--
-- Зачем: история версий страницы = доступ к каждому прошлому
-- состоянию документа (включая удалённые куски текста) + право
-- откатить страницу назад. Это чувствительнее обычного чтения:
-- по дефолту `kb.view_pages` есть и у hostess/waiter, а копаться
-- в истории правок должны только те, кому это нужно по работе.
--
-- RLS на `kb_page_versions` НАМЕРЕННО не ужесточаем. Тот же
-- select-policy (`kb_page_versions_select`, миграция 116)
-- обслуживает required-reading (needs_reread считает latest
-- version_number) и KB-landing — оба работают у рядовых
-- сотрудников БЕЗ права на историю. Ужесточение policy
-- регрессировало бы их. Поэтому фичу-поверхность (список/диф/
-- restore версий) гейтим на server-action слое — см.
-- src/lib/knowledge/versions.ts (canViewVersionHistory) + UI
-- скрывает пункт меню (kb-page-menu.tsx). Account-изоляция и
-- `kb.view_pages` по-прежнему остаются на RLS.
--
-- Дефолтная матрица: owner / manager / admin / accountant — YES;
-- hostess / waiter — NO (только потребители контента). Бэкфилл
-- существующих preset-ролей + триггер на будущие — паттерн 175
-- (hardcoded UUID ролей больше не используем: после 138 не-owner
-- системные роли удалены, дефолтные роли теперь per-venue
-- `custom_*` со случайными id).
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000093',
   'kb.view_version_history',
   'Смотреть историю версий страниц и восстанавливать их',
   'kb');

-- Owner — системная роль с фиксированным id; держит все права.
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000001'::uuid, p.id, true
from public.permissions p
where p.code = 'kb.view_version_history'
on conflict (role_id, permission_id)
do update set granted = excluded.granted;

-- Существующие preset-роли всех аккаунтов (созданы до этой миграции).
insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.roles r
join public.permissions p on p.code = 'kb.view_version_history'
where r.code in ('custom_manager', 'custom_admin', 'custom_accountant')
on conflict (role_id, permission_id)
do update set granted = excluded.granted;

-- Будущие preset-роли (создаются seed_default_venue_roles или иным
-- путём на уже мигрированной БД) — выравниваем триггером, как 175.
create or replace function public.apply_default_kb_version_history_to_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.code in ('custom_manager', 'custom_admin', 'custom_accountant') then
    insert into public.role_permissions (role_id, permission_id, granted)
    select new.id, p.id, true
    from public.permissions p
    where p.code = 'kb.view_version_history'
    on conflict (role_id, permission_id)
    do update set granted = excluded.granted;
  end if;

  return new;
end;
$$;

drop trigger if exists roles_apply_default_kb_version_history on public.roles;
create trigger roles_apply_default_kb_version_history
after insert on public.roles
for each row
execute function public.apply_default_kb_version_history_to_role();

revoke all on function public.apply_default_kb_version_history_to_role() from public;
