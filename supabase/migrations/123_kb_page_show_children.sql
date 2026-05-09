-- ============================================================
-- 123_kb_page_show_children.sql
-- Page-level toggle for the automatic "Подстраницы" section.
-- ============================================================

alter table public.kb_pages
  add column if not exists show_children boolean;

alter table public.kb_pages
  alter column show_children set default false;

comment on column public.kb_pages.show_children is
  'Whether the automatic direct-children section is shown under the KB page body.';

create or replace function public.kb_set_page_show_children(
  p_page_id uuid,
  p_show_children boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_page         public.kb_pages%rowtype;
  v_can_edit_any boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own boolean := public.has_permission('kb.edit_own_pages');
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;

  select * into v_page
    from public.kb_pages
   where id = p_page_id
   for update;

  if not found or v_page.deleted_at is not null then
    raise exception 'Страница не найдена' using errcode = 'P0002';
  end if;

  if v_page.account_id <> public.get_active_account_id() then
    raise exception 'Страница из другого аккаунта' using errcode = '42501';
  end if;

  if not (v_can_edit_any or (v_can_edit_own and v_page.created_by = v_uid)) then
    raise exception 'Нет права редактировать страницу' using errcode = '42501';
  end if;

  update public.kb_pages
     set show_children = coalesce(p_show_children, false),
         updated_by = v_uid
   where id = p_page_id
     and show_children is distinct from coalesce(p_show_children, false);
end;
$$;

comment on function public.kb_set_page_show_children(uuid, boolean) is
  'Toggles the automatic direct-children section for a KB page.';

grant execute on function public.kb_set_page_show_children(uuid, boolean) to authenticated;
