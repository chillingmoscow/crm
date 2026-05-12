-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 143_medbook_notification_text_polish.sql
--
-- Уточняем body уведомления о медкнижке: добавляем явный call-to-action
-- «сдайте анализы, чтобы продолжать работу» — без этого юзер видит
-- только «срок действия заканчивается» и не понимает что от него
-- ждут.
--
-- Старая версия функции в миграции 135. Логика та же (atomic claim
-- через UPDATE ... RETURNING + per-row branch по days_left); меняем
-- только тексты v_body.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enqueue_medical_book_expiry_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  r record;
  v_days_left integer;
  v_title text;
  v_body  text;
begin
  for r in
    update public.staff_account_details sad
       set medical_book_expiry_notified_for = sad.medical_book_date
     where sad.medical_book_date is not null
       and sad.medical_book_date <= current_date + interval '30 days'
       and (
         sad.medical_book_expiry_notified_for is null
         or sad.medical_book_expiry_notified_for <> sad.medical_book_date
       )
       and exists (
         select 1
         from public.user_venue_roles uvr
         join public.venues v on v.id = uvr.venue_id
         where uvr.user_id  = sad.user_id
           and uvr.status   = 'active'
           and v.account_id = sad.account_id
       )
     returning sad.account_id, sad.user_id, sad.medical_book_date
  loop
    v_days_left := (r.medical_book_date - current_date)::integer;
    if v_days_left < 0 then
      v_title := 'Медкнижка просрочена';
      v_body  := 'Срок действия медкнижки истёк ' ||
                 to_char(r.medical_book_date, 'DD.MM.YYYY') ||
                 '. Сдайте анализы и обновите медкнижку, чтобы продолжать работу.';
    elsif v_days_left = 0 then
      v_title := 'Сегодня истекает медкнижка';
      v_body  := 'Срок действия медкнижки заканчивается сегодня. ' ||
                 'Сдайте анализы и обновите медкнижку, чтобы продолжать работу.';
    else
      v_title := 'Скоро истекает медкнижка';
      v_body  := 'Срок действия медкнижки заканчивается ' ||
                 to_char(r.medical_book_date, 'DD.MM.YYYY') ||
                 ' (через ' || v_days_left || ' дн.). ' ||
                 'Запишитесь на анализы заранее, чтобы не было перерыва в работе.';
    end if;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      r.user_id,
      'staff.medical_book_expiring',
      v_title,
      v_body,
      '/profile'
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;
