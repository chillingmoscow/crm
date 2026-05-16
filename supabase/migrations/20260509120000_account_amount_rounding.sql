alter table public.accounts
  add column if not exists amount_rounding_scale smallint not null default 1
  check (amount_rounding_scale in (0, 1, 2));

comment on column public.accounts.amount_rounding_scale is
  'Account-wide amount display precision: 0 = whole, 1 = tenths, 2 = hundredths.';
