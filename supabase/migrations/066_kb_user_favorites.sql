-- ============================================================
-- 066_kb_user_favorites.sql
-- Per-user избранное страниц KB. Pivot user × page без дополнительных
-- метаданных (только created_at для сортировки).
--
-- Видимость: юзер видит ТОЛЬКО свои favorites в текущем активном
-- account'е (мульти-tenant изоляция). Add/remove — только свои.
--
-- account_id денормализуется (можно было бы джойнить через kb_pages),
-- чтобы RLS-policy была дешёвой и работала без cross-table join'а.
-- ============================================================

create table public.kb_user_favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  page_id    uuid not null references public.kb_pages(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

create index kb_user_favorites_user_account_idx
  on public.kb_user_favorites(user_id, account_id, created_at desc);

comment on table public.kb_user_favorites is
  'Избранные KB-страницы по пользователю. Видны только владельцу '
  'и только в его активном account''е.';

alter table public.kb_user_favorites enable row level security;

create policy "kb_user_favorites_select" on public.kb_user_favorites
  for select using (
    user_id = auth.uid()
    and account_id = public.get_active_account_id()
  );

-- INSERT: дополнительно валидируем, что page_id реально лежит в
-- текущем active account'е и не soft-deleted. Без этого юзер,
-- знающий UUID страницы из чужого account'а, мог бы создать
-- «cross-tenant» favorite (PK = (user_id, page_id), и потом
-- favoriting той же страницы в её настоящем account'е падал бы на
-- 23505 — ON CONFLICT silently глотался → toggle visually fail).
-- См. Codex #42 P1.
create policy "kb_user_favorites_insert" on public.kb_user_favorites
  for insert with check (
    user_id = auth.uid()
    and account_id = public.get_active_account_id()
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_user_favorites.page_id
         and kp.account_id = public.get_active_account_id()
         and kp.deleted_at is null
    )
    and public.has_permission('kb.view_pages')
  );

-- DELETE: ограничиваем active account'ом — иначе работая в одном
-- account'е, юзер мог бы стирать свои favorites из другого account'а
-- (передав page_id той страницы в server-action). См. Codex #42 P2.
create policy "kb_user_favorites_delete" on public.kb_user_favorites
  for delete using (
    user_id = auth.uid()
    and account_id = public.get_active_account_id()
  );

grant select, insert, delete on public.kb_user_favorites to authenticated;
