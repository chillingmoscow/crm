-- ============================================================
-- 160_security_advisor_cleanup.sql
--
-- Закрывает security-warnings из Supabase Advisor:
--   1. function_search_path_mutable × 15 — фиксируем search_path
--      у триггерных функций (предотвращает search-path-hijack,
--      если функция когда-нибудь станет SECURITY DEFINER).
--   2. extension_in_public (vector) — переносим pgvector в схему
--      `extensions`. Таблица kb_page_embeddings + два RPC, которые
--      держат тип vector, дропаются и пересоздаются (на проде данных
--      нет — embeddings перебилдятся через KB-pipeline при сохранении
--      страниц).
--   3. rls_enabled_no_policy (kb_thread_recipient_cooldown) — делаем
--      намеренный deny-all явным через policy `using (false)`.
--
-- Performance-warnings (auth_rls_initplan, multiple_permissive_policies,
-- unindexed_foreign_keys, unused_index) намеренно НЕ трогаем — отдельный
-- заход (см. BACKLOG.md).
-- ============================================================

-- ── 1. search_path для 15 функций ─────────────────────────────
-- Все эти функции внутри используют schema-qualified ссылки
-- (auth.uid(), public.kb_pages, и built-ins из pg_catalog), поэтому
-- search_path = public, pg_catalog не меняет семантику.

alter function public.tg_roles_set_updated()                set search_path = public, pg_catalog;
alter function public.tg_roles_set_created()                set search_path = public, pg_catalog;
alter function public.tg_sad_set_updated()                  set search_path = public, pg_catalog;
alter function public.tg_sad_set_created()                  set search_path = public, pg_catalog;
alter function public.bank_account_balance_guard()          set search_path = public, pg_catalog;
alter function public.kb_pages_touch_updated()              set search_path = public, pg_catalog;
alter function public.kb_pages_check_no_cycle()             set search_path = public, pg_catalog;
alter function public.kb_generate_slug()                    set search_path = public, pg_catalog;
alter function public.kb_collections_touch_updated()        set search_path = public, pg_catalog;
alter function public.tg_departments_check_head_role()      set search_path = public, pg_catalog;
alter function public.tg_departments_set_created()          set search_path = public, pg_catalog;
alter function public.tg_departments_set_updated()          set search_path = public, pg_catalog;
alter function public.tg_roles_check_department()           set search_path = public, pg_catalog;
alter function public.tg_profiles_track_birth_date()        set search_path = public, pg_catalog;
alter function public.tg_profiles_birth_date_yearly_limit() set search_path = public, pg_catalog;


-- ── 2. vector extension → schema extensions ───────────────────
-- Supabase рекомендует держать расширения в схеме `extensions`, а не
-- в `public`. Тип vector(N) и operator class vector_cosine_ops живут
-- внутри extension'а, поэтому при переселении нужно сначала снести
-- объекты, у которых они в зависимостях.
--
-- ВАЖНО: на проде в kb_page_embeddings данных нет (RAG-фича не успела
-- набрать сохранений). На локальных dev-БД при наличии данных таблица
-- пересоздаётся, embeddings регенерятся автоматически при следующем
-- сохранении KB-страницы (см. src/lib/knowledge/embeddings.ts).

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Делаем 'extensions' частью search_path по умолчанию для базы,
-- чтобы unqualified `vector(1024)` в существующем коде/типах
-- продолжал работать без явного префикса `extensions.`.
alter database postgres set search_path = "$user", public, extensions;

-- Сносим объекты, которые держат тип vector.
drop function if exists public.kb_search_embeddings(vector, integer);
drop function if exists public.kb_replace_page_embeddings(uuid, timestamptz, jsonb);
drop table if exists public.kb_page_embeddings cascade;

-- Переселение pgvector.
drop extension if exists vector;
create extension if not exists vector with schema extensions;

-- Воссоздаём таблицу — структура идентична 072_kb_embeddings.sql, тип
-- vector теперь резолвится из схемы extensions.
create table public.kb_page_embeddings (
  id              bigserial primary key,
  page_id         uuid not null references public.kb_pages(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  chunk_index     integer not null,
  content_chunk   text not null,
  embedding       extensions.vector(1024) not null,
  created_at      timestamptz not null default now(),

  constraint kb_page_embeddings_unique unique (page_id, chunk_index)
);

create index kb_page_embeddings_cosine_idx
  on public.kb_page_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create index kb_page_embeddings_account_idx
  on public.kb_page_embeddings(account_id, page_id);

comment on table public.kb_page_embeddings is
  'Embeddings KB-страниц для RAG. 1 страница = N chunks (по headings). '
  'Re-embedded после каждого kb_save_page. SiliconFlow bge-m3, 1024 dim.';

-- RLS — копия из 072.
alter table public.kb_page_embeddings enable row level security;

create policy "kb_page_embeddings_select" on public.kb_page_embeddings
  for select using (
    account_id = public.get_active_account_id()
  );

create policy "kb_page_embeddings_write" on public.kb_page_embeddings
  for all using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.create_pages')
  ) with check (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.create_pages')
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_page_embeddings.page_id
         and kp.account_id = public.get_active_account_id()
    )
  );

grant select, insert, update, delete on public.kb_page_embeddings to authenticated;
grant usage, select on sequence public.kb_page_embeddings_id_seq to authenticated;

-- RPC: kb_search_embeddings — top-K cosine search в active account.
create or replace function public.kb_search_embeddings(
  p_query_embedding extensions.vector(1024),
  p_limit integer default 5
)
returns table (
  page_id        uuid,
  chunk_index    integer,
  content_chunk  text,
  page_title     text,
  page_slug      text,
  page_icon      text,
  page_icon_color text,
  similarity     real
)
language sql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
  select
    e.page_id,
    e.chunk_index,
    e.content_chunk,
    p.title       as page_title,
    p.slug        as page_slug,
    p.icon        as page_icon,
    p.icon_color  as page_icon_color,
    (1 - (e.embedding <=> p_query_embedding))::real as similarity
  from public.kb_page_embeddings e
  join public.kb_pages p
    on p.id = e.page_id
   and p.deleted_at is null
  where e.account_id = public.get_active_account_id()
    and public.has_permission('kb.ask_ai')
    and exists (
      select 1 from public.accounts a
       where a.id = e.account_id and a.ai_enabled = true
    )
  order by e.embedding <=> p_query_embedding
  limit greatest(1, least(p_limit, 20));
$$;

comment on function public.kb_search_embeddings(extensions.vector, integer) is
  'Top-K cosine-similar chunks из KB в active account. Возвращает '
  'chunk + page-meta. Используется RAG-action askKbAi. Внутри RPC '
  'enforced kb.ask_ai permission + accounts.ai_enabled — direct '
  'PostgREST вызов без gate''а вернёт пустой набор.';

grant execute on function public.kb_search_embeddings(extensions.vector, integer) to authenticated;

-- RPC: kb_replace_page_embeddings — атомарный re-embed.
create or replace function public.kb_replace_page_embeddings(
  p_page_id uuid,
  p_expected_updated_at timestamptz,
  p_chunks jsonb
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_current_updated_at timestamptz;
  v_found boolean;
begin
  if not public.has_permission('kb.create_pages') then
    return 'forbidden';
  end if;

  select updated_at, true into v_current_updated_at, v_found
    from public.kb_pages
   where id = p_page_id
     and account_id = v_account_id
     and deleted_at is null;

  if not v_found then
    return 'no_page';
  end if;

  if v_current_updated_at is distinct from p_expected_updated_at then
    return 'stale';
  end if;

  delete from public.kb_page_embeddings where page_id = p_page_id;

  if jsonb_array_length(coalesce(p_chunks, '[]'::jsonb)) > 0 then
    insert into public.kb_page_embeddings
      (page_id, account_id, chunk_index, content_chunk, embedding)
    select
      p_page_id,
      v_account_id,
      (chunk->>'chunk_index')::integer,
      chunk->>'content_chunk',
      (chunk->>'embedding')::extensions.vector
    from jsonb_array_elements(p_chunks) as chunk;
  end if;

  return 'ok';
end;
$$;

comment on function public.kb_replace_page_embeddings(uuid, timestamptz, jsonb) is
  'Атомарно заменяет embedding-chunks страницы. Принимает '
  'expected_updated_at для freshness-guard (старая background-job '
  'возвращает stale если страница успела сохраниться снова). Возвращает '
  '"ok" / "stale" / "no_page" / "forbidden".';

grant execute on function public.kb_replace_page_embeddings(uuid, timestamptz, jsonb) to authenticated;


-- ── 3. kb_thread_recipient_cooldown: explicit deny-all policy ─
-- Таблица служебная — пишется только из SECURITY DEFINER триггера
-- kb_notify_comment_added (под service_role). До этого RLS был
-- включён без policies — функционально это deny-all для не-service-
-- role, но Supabase linter ругается на "RLS enabled, no policies".
-- Делаем deny-all явным: linter довольнен, intent читается из кода,
-- и случайный GRANT в будущем не откроет таблицу.

revoke all on public.kb_thread_recipient_cooldown from anon, authenticated;

drop policy if exists "kb_thread_recipient_cooldown_deny_all"
  on public.kb_thread_recipient_cooldown;

create policy "kb_thread_recipient_cooldown_deny_all"
  on public.kb_thread_recipient_cooldown
  for all
  to public
  using (false) with check (false);

comment on policy "kb_thread_recipient_cooldown_deny_all"
  on public.kb_thread_recipient_cooldown is
  'Намеренный deny-all. Таблица пишется только из SECURITY DEFINER '
  'триггера kb_notify_comment_added под service_role. Прямого доступа '
  'из user-сессии быть не должно.';
