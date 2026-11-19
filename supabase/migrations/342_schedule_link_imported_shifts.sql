-- Смены из однократного переноса старого графика («Однократный перенос
-- графика.» в заметке) пришли со старыми названиями — «Менеджер №1»,
-- «Мастер №2», «Бармен №1», «Барбек» — и часть из них без шаблона.
-- Привязываем их к шаблону по старому названию: берём шаблон, к которому
-- уже привязаны другие смены с тем же названием в этом заведении, если он
-- один («Менеджер №1» → «Менеджер · день», «Барбек» → «Клиннер» после
-- переименования шаблона). Название смены приводим к названию шаблона.
--
-- Не трогаем:
--   • смены, у которых по названию нет однозначного шаблона («Бармен №2»);
--   • смены с задачами (их нельзя перепривязывать — защита отчётов);
--   • день, где по шаблону уже есть другая смена (одна смена по шаблону в день);
--     из двух перенесённых смен с одним названием в один день привязываем
--     только первую по времени.
-- Время, сотрудник, должность и оплата не меняются.
--
-- Это выравнивание метаданных, а не изменение факта смены: пересчёт
-- зарплаты за прошлые дни не запускаем (как в миграции 253).
begin;

alter table public.schedule_shifts disable trigger schedule_queue_payroll;

with linked as (
  select venue_id, title, template_id
  from public.schedule_shifts
  where template_id is not null
  group by venue_id, title, template_id
),
unique_title as (
  select venue_id, title, min(template_id::text)::uuid as template_id
  from linked
  group by venue_id, title
  having count(*) = 1
),
candidate as (
  select s.id, u.template_id, t.name as template_name,
         row_number() over (
           partition by s.venue_id, u.template_id, (s.starts_at at time zone v.timezone)::date
           order by s.starts_at, s.id
         ) as day_rank
  from public.schedule_shifts s
  join unique_title u on u.venue_id = s.venue_id and u.title = s.title
  join public.schedule_templates t on t.id = u.template_id and t.venue_id = s.venue_id
  join public.venues v on v.id = s.venue_id
  where s.template_id is null
    and s.note like 'Однократный перенос графика.%'
    and not exists (select 1 from public.schedule_task_occurrences o where o.shift_id = s.id)
    and not exists (
      select 1 from public.schedule_shifts other
      where other.venue_id = s.venue_id
        and other.template_id = u.template_id
        and other.id <> s.id
        and (other.starts_at at time zone v.timezone)::date = (s.starts_at at time zone v.timezone)::date
    )
),
-- Две перенесённые смены с одним названием в один день: к шаблону
-- привязываем только первую по времени, вторая остаётся без шаблона.
target as (
  select id, template_id, template_name from candidate where day_rank = 1
)
update public.schedule_shifts s
   set template_id = target.template_id,
       title = target.template_name,
       version = s.version + 1
  from target
 where s.id = target.id;

alter table public.schedule_shifts enable trigger schedule_queue_payroll;

commit;
