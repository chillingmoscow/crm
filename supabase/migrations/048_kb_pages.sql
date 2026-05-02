-- ============================================================
-- 048_kb_pages.sql
-- Stage 8.0 — Knowledge Base: основная таблица страниц.
--
-- Иерархия Notion-style: бесконечная вложенность через parent_id
-- (self-ref). Контент — JSON BlockNote в jsonb. Поиск — generated
-- tsvector из title + plain_text (plain_text пишется server action'ом
-- из BlockNoteEditor.blocksToMarkdownLossy на сохранении).
--
-- См. ~/.claude/plans/imperative-swinging-sparrow.md §2.1.
-- ============================================================

create table public.kb_pages (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,

  parent_id       uuid,
  position        integer not null default 0,

  title           text not null default 'Без названия',
  icon            text,
  cover_url       text,
  -- Короткий человекочитаемый ID для URL (nanoid 8 символов).
  -- НЕ зависит от title — переименование страницы не меняет URL.
  slug            text not null,

  -- BlockNote-контент (массив блоков). Пустой массив = пустая страница.
  content         jsonb not null default '[]'::jsonb,
  -- Plain-text проекция content для full-text search. Поддерживается
  -- server action'ом savePage (см. src/lib/knowledge/pages.ts).
  plain_text      text not null default '',
  search_tsv      tsvector
                    generated always as (
                      to_tsvector('russian',
                        coalesce(title, '') || ' ' || coalesce(plain_text, '')
                      )
                    ) stored,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id),

  -- Composite unique нужен для composite FK ниже (tenant-консистентность).
  constraint kb_pages_account_id_unique unique (account_id, id),

  -- parent должен принадлежать тому же account, что и child.
  constraint kb_pages_parent_tenant_fkey
    foreign key (account_id, parent_id)
    references public.kb_pages (account_id, id)
    on delete cascade,

  -- slug уникален в рамках аккаунта (не глобально).
  constraint kb_pages_slug_account_unique unique (account_id, slug)
);

create index kb_pages_account_idx       on public.kb_pages(account_id);
create index kb_pages_parent_idx        on public.kb_pages(account_id, parent_id, position);
create index kb_pages_search_idx        on public.kb_pages using gin (search_tsv);
create index kb_pages_not_deleted_idx   on public.kb_pages(account_id, updated_at desc nulls last)
  where deleted_at is null;

comment on table public.kb_pages is
  'Страницы базы знаний. Иерархия через parent_id (self-ref). '
  'Контент BlockNote в jsonb, plain_text для FTS обновляется server action''ом.';

-- ============================================================
-- Триггер: запрет циклов в иерархии.
-- При update parent_id проверяем, что NEW.id не встречается в цепочке
-- предков NEW.parent_id. На insert NEW.id ещё не может быть
-- предком (он только создаётся), но всё равно прогоняем для единообразия.
-- ============================================================

create or replace function public.kb_pages_check_no_cycle()
returns trigger
language plpgsql
as $$
declare
  v_current uuid;
  v_steps   integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  -- Самоссылка — сразу отказ.
  if new.parent_id = new.id then
    raise exception 'kb_pages: страница не может быть собственным родителем (id=%)', new.id;
  end if;

  v_current := new.parent_id;
  while v_current is not null loop
    if v_current = new.id then
      raise exception
        'kb_pages: цикл в иерархии — id=% попал в собственную ветку предков',
        new.id;
    end if;

    -- Защита от бесконечного цикла на случай, если данные уже битые.
    v_steps := v_steps + 1;
    if v_steps > 1000 then
      raise exception 'kb_pages: глубина иерархии > 1000 — возможен цикл, проверьте данные';
    end if;

    select parent_id into v_current
    from public.kb_pages
    where id = v_current;
  end loop;

  return new;
end;
$$;

create trigger trg_kb_pages_no_cycle
  before insert or update of parent_id on public.kb_pages
  for each row execute function public.kb_pages_check_no_cycle();

-- ============================================================
-- Триггер: автоподстановка updated_at / updated_by на UPDATE.
-- (created_at / created_by заполняются server action'ом на INSERT.)
-- ============================================================

create or replace function public.kb_pages_touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  -- updated_by пишется server action'ом, но если забыли — подставим
  -- текущего пользователя (auth.uid() может быть null в системных
  -- контекстах — тогда оставим как есть).
  if new.updated_by is null and auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger trg_kb_pages_touch_updated
  before update on public.kb_pages
  for each row execute function public.kb_pages_touch_updated();
