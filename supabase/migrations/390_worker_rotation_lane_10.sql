-- ============================================================
-- 390_worker_rotation_lane_10.sql
-- Исправление к 389: ротация фонового обработчика стала на 11 полос
-- (полоса 10 — фото блюд), а ограничение номера полосы осталось 0–9.
-- Переход на полосу 10 падал на проверке, и /api/cron/sales-shifts отвечал
-- 500 на каждом тике (прод, 25.11.2026 13:40–14:10 UTC). Так же расширяли
-- ограничение 287–293 при добавлении полос.
-- ============================================================

alter table private.sales_worker_rotation drop constraint sales_worker_rotation_lane_check;
alter table private.sales_worker_rotation
  add constraint sales_worker_rotation_lane_check check (lane between 0 and 10);
