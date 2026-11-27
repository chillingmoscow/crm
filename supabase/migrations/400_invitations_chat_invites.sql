-- Приглашение по email помнит, звать ли сотрудника в Telegram-чаты должности
-- после принятия. Решает тот, кто приглашает (переключатель в «Добавить →
-- Пригласить»); приглашения, отправленные до этой миграции, в чаты не зовут.

begin;

alter table public.invitations
  add column chat_invites boolean not null default false;

comment on column public.invitations.chat_invites is
  'Пригласить в Telegram-чаты должности, когда сотрудник примет приглашение.';

commit;
