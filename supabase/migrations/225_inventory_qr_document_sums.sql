-- Суммы акта из Quick Resto — в собственные колонки.
--
-- Что было: documents.shortfall_sum / surplus_sum заполнялись значениями из
-- Quick Resto (синхронизация, отправка акта, проведение). При этом список актов
-- показывает в колонке «Итоги» УПРАВЛЕНЧЕСКИЙ итог — он считается по строкам с
-- учётом исключений и пересортов и перетирает эти же поля уже в памяти
-- (src/lib/inventory/list-documents.ts). Итог: сохранённые числа Quick Resto не
-- доходили ни до одного экрана, а в одной колонке жили две несравнимые метрики.
--
-- Что делаем: суммы Quick Resto переезжают в qr_shortfall_sum / qr_surplus_sum
-- и показываются как есть (карточка акта, опциональная колонка списка).
-- shortfall_sum / surplus_sum остаются управленческой метрикой, которая
-- считается при чтении списка; хранимые значения обнуляем, чтобы старые числа
-- Quick Resto не выдавали себя за управленческий итог.

alter table public.documents
  add column if not exists qr_shortfall_sum numeric,
  add column if not exists qr_surplus_sum   numeric;

comment on column public.documents.qr_shortfall_sum is
  'Недостача по акту так, как её посчитал сам Quick Resto (поле shortfallSum документа). Заполняется только у проведённого акта: до проведения QR отдаёт нули.';
comment on column public.documents.qr_surplus_sum is
  'Излишек по акту так, как его посчитал сам Quick Resto (поле surplusSum документа). Заполняется только у проведённого акта.';
comment on column public.documents.shortfall_sum is
  'Управленческая недостача (с учётом исключённых строк и активных пересортов). Считается по строкам при чтении списка — см. src/lib/inventory/list-documents.ts. Сумму самого Quick Resto смотри в qr_shortfall_sum.';
comment on column public.documents.surplus_sum is
  'Управленческий излишек (с учётом исключённых строк и активных пересортов). Считается по строкам при чтении списка. Сумму самого Quick Resto смотри в qr_surplus_sum.';

-- Бэкфилл: всё, что лежит в shortfall_sum / surplus_sum сейчас, пришло из
-- Quick Resto (других писателей у этих колонок не было).
update public.documents
   set qr_shortfall_sum = shortfall_sum,
       qr_surplus_sum   = surplus_sum
 where document_kind = 'inventory'
   and (shortfall_sum is not null or surplus_sum is not null)
   and qr_shortfall_sum is null
   and qr_surplus_sum is null;

-- И убираем QR-числа из управленческих колонок: список считает их сам, а
-- оставшиеся значения читались бы как управленческий итог у актов, по которым
-- построчных данных нет.
update public.documents
   set shortfall_sum = null,
       surplus_sum   = null
 where document_kind = 'inventory'
   and (shortfall_sum is not null or surplus_sum is not null);
