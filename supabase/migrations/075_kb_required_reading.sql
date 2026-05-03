-- ============================================================
-- 075_kb_required_reading.sql
-- Sprint C / 1.2 — Required-reading + read-receipts.
--
-- Compliance-фича: admin помечает страницу «обязательной к прочтению»
-- (например, регламент по технике безопасности или onboarding-чек-лист).
-- Сотрудник видит баннер «Требуется прочтение», нажимает «Подтверждаю
-- прочитано» — INSERT в kb_page_reads. После этого баннер сменяется
-- бейджем «✓ Прочитано <дата>».
--
-- Что НЕ покрывает MVP (отдельные PR):
--   • Admin-view «кто прочитал, кто нет» — нужен пул юзеров «кто
--     должен прочитать», стратегия по ролям. Отдельным PR.
--   • Re-read при обновлении контента (если контент меняется —
--     требовать повторного подтверждения). Отдельным PR.
--   • Notification на mark-as-required (push в notifications).
-- ============================================================

-- ============================================================
-- 1. kb_pages.required_reading column
-- ============================================================

alter table public.kb_pages
  add column if not exists required_reading boolean not null default false;

comment on column public.kb_pages.required_reading is
  'Помечена ли страница как обязательная к прочтению (compliance). '
  'Toggled через server-action под kb.manage_required_reading. См. '
  'kb_page_reads для записей о подтверждениях.';

-- Indexed для фильтра на dashboard'е «мои непрочитанные».
create index if not exists kb_pages_required_reading_idx
  on public.kb_pages(account_id, required_reading)
  where required_reading = true and deleted_at is null;

-- ============================================================
-- 2. kb_page_reads — pivot user × page → read_at
-- ============================================================

create table public.kb_page_reads (
  user_id     uuid not null references auth.users(id) on delete cascade,
  page_id     uuid not null references public.kb_pages(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (user_id, page_id)
);

create index kb_page_reads_account_user_idx
  on public.kb_page_reads(account_id, user_id, read_at desc);

comment on table public.kb_page_reads is
  'Подтверждения прочтения KB-страниц per-user. PK (user_id, page_id) — '
  'один read = одна запись (no re-read tracking в MVP). Created via '
  'markKbPageAsRead server-action.';

alter table public.kb_page_reads enable row level security;

-- SELECT: только свои записи. Admin-view «кто прочитал» добавим
-- отдельной RPC под kb.view_required_reading_stats.
create policy "kb_page_reads_select_own" on public.kb_page_reads
  for select using (
    user_id = auth.uid()
    and account_id = public.get_active_account_id()
  );

-- INSERT: только свои записи + страница реально existsexists в active
-- account и не soft-deleted (защита от cross-tenant insert через
-- crafted page_id — паттерн из 066 §INSERT, Codex #42 P1).
create policy "kb_page_reads_insert_own" on public.kb_page_reads
  for insert with check (
    user_id = auth.uid()
    and account_id = public.get_active_account_id()
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_page_reads.page_id
         and kp.account_id = public.get_active_account_id()
         and kp.deleted_at is null
    )
    and public.has_permission('kb.view_pages')
  );

-- НЕТ UPDATE / DELETE для юзеров — read = compliance-подтверждение,
-- отозвать его нельзя. Если страница изменится → отдельный flow
-- re-read (пока не реализован).

grant select, insert on public.kb_page_reads to authenticated;

-- ============================================================
-- 3. Permission `kb.manage_required_reading`
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000060',
   'kb.manage_required_reading',
   'Помечать страницы как обязательные к прочтению',
   'kb');

-- Дефолтная матрица: только owner / admin. Manager / accountant
-- НЕ дают (compliance-серьёзное действие — должно быть централизованно).
-- hostess / waiter — нет (только потребители).
insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000060'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000003'::uuid)   -- admin
) as r(role_id);
