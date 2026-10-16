begin;
select set_config('test.payroll_owner',(select id::text from auth.users where email='owner@test.com'),true);
set local role authenticated;
do $test$
declare u uuid;v uuid;cfg jsonb:=$config${
  "medical": {
    "reminders": true,
    "reminder_after_hire_days": 3,
    "reminder_before_expiry_days": 30,
    "submission_fine": true,
    "submission_after_hire_months": 1,
    "submission_amount": 3000,
    "expiry_fine": true,
    "expiry_amount": 3000,
    "expiry_frequency": "once_per_expiry_case",
    "reimbursement": true,
    "reimbursement_amount": 3000,
    "reimbursement_after_exam_months": 3,
    "reimbursement_requires_exam_after_hire": true
  },
  "uniform": {
    "enabled": true,
    "installments": 4,
    "payment_days": [
      3,
      18
    ]
  },
  "tasks": {
    "missing_enabled": true,
    "missing_kind": "deduction",
    "missing_amount": 200,
    "extra_reward_enabled": true,
    "extra_reward_medium": "bonus"
  },
  "gifts": {
    "enabled": true,
    "tenure_boundary_days": 90,
    "holidays": [
      {
        "id": "b57adfd111c54f05a01943e818788f43",
        "name": "День рождения",
        "month_day": "",
        "junior_amount": 3000,
        "senior_amount": 7000,
        "roles": [
          "Хостес",
          "Бармен",
          "Управляющий",
          "Официант",
          "Мастер"
        ],
        "gender": "all"
      },
      {
        "id": "eb773d37e6264c2995e6fbe7caa434c0",
        "name": "Новый год",
        "month_day": "01-01",
        "junior_amount": 1000,
        "senior_amount": 3000,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Управляющий",
          "Официант"
        ],
        "gender": "all"
      },
      {
        "id": "b63219d7a18f41379a83ec498007f6b4",
        "name": "День бармена",
        "month_day": "02-06",
        "junior_amount": 1000,
        "senior_amount": 2000,
        "roles": [
          "Бармен"
        ],
        "gender": "all"
      },
      {
        "id": "4d463fab73514711ba40f7c61375ce7e",
        "name": "23 февраля",
        "month_day": "02-23",
        "junior_amount": 1000,
        "senior_amount": 2000,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Управляющий",
          "Официант"
        ],
        "gender": "male"
      },
      {
        "id": "b4c79bce5d2c4000926a15d9157acda3",
        "name": "8 марта",
        "month_day": "03-08",
        "junior_amount": 1000,
        "senior_amount": 2000,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Управляющий",
          "Официант"
        ],
        "gender": "female"
      },
      {
        "id": "77b2c1afc252436a9ed48eac23204e5f",
        "name": "День кальянного мастера",
        "month_day": "07-01",
        "junior_amount": 1000,
        "senior_amount": 2000,
        "roles": [
          "Мастер"
        ],
        "gender": "all"
      }
    ],
    "tenure": [
      {
        "days": 60,
        "amount": 0,
        "discount_percent": 0,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Официант"
        ]
      },
      {
        "days": 120,
        "amount": 0,
        "discount_percent": 0,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Официант"
        ]
      },
      {
        "days": 180,
        "amount": 0,
        "discount_percent": 0,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Официант"
        ]
      },
      {
        "days": 270,
        "amount": 3000,
        "discount_percent": 0,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Официант"
        ]
      },
      {
        "days": 366,
        "amount": 5000,
        "discount_percent": 10,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Официант"
        ]
      },
      {
        "days": 550,
        "amount": 7000,
        "discount_percent": 15,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Официант"
        ]
      },
      {
        "days": 770,
        "amount": 10000,
        "discount_percent": 20,
        "roles": [
          "Хостес",
          "Бармен",
          "Мастер",
          "Официант"
        ]
      }
    ]
  }
}
$config$::jsonb;n integer;before_count bigint;expected_version integer;
begin
 u:=current_setting('test.payroll_owner')::uuid;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 v:=public.get_active_venue_id();
 if v is null then raise exception 'Missing local test venue';end if;
 select coalesce(max(version),0) into expected_version from public.payroll_automation_settings where venue_id=v;
 select count(*) into before_count from public.payroll_adjustments;
 perform public.payroll_save_automation_settings(v,expected_version,cfg);
 if (select config from public.payroll_automation_settings where venue_id=v)<>cfg then raise exception 'Configuration round trip failed';end if;
 if not exists(select 1 from public.payroll_automation_settings_history where venue_id=v and version=expected_version+1) then raise exception 'No immutable revision';end if;
 begin
  perform public.payroll_save_automation_settings(v,expected_version,cfg);
  raise exception 'Stale save was accepted';
 exception when raise_exception then if sqlerrm not like 'Настройки изменились%' then raise;end if;end;
 begin
  perform public.payroll_save_automation_settings(v,expected_version+1,jsonb_set(cfg,'{medical,expiry_amount}','-3000'));
  raise exception 'Negative fine accepted';
 exception when raise_exception then if sqlerrm not like 'Проверьте настройки%' then raise;end if;end;
 begin
  perform public.payroll_save_automation_settings(v,expected_version+1,jsonb_set(cfg,'{medical,expiry_frequency}','"daily"'));
  raise exception 'Daily fine accepted';
 exception when raise_exception then if sqlerrm not like 'Проверьте настройки%' then raise;end if;end;
 begin
  perform public.payroll_save_automation_settings('00000000-0000-0000-0000-000000000001',0,cfg);
  raise exception 'Cross venue write accepted';
 exception when raise_exception then if sqlerrm<>'Нет доступа' then raise;end if;end;
 if has_table_privilege('authenticated','public.payroll_automation_settings','UPDATE') or has_table_privilege('authenticated','public.payroll_automation_settings_history','INSERT') then raise exception 'Direct write access';end if;
 if (select count(*) from public.payroll_adjustments)<>before_count then raise exception 'Saving settings generated financial rows';end if;
 perform public.payroll_save_automation_settings(v,expected_version+1,jsonb_set(cfg,'{medical,expiry_amount}','3500'));
 if (select version from public.payroll_automation_settings where venue_id=v)<>expected_version+2 then raise exception 'Version did not advance';end if;
 if not exists(select 1 from public.audit_logs where entity_id=v and action_code='payroll.automation_settings.updated' and details#>>'{after,medical,expiry_amount}'='3500') then raise exception 'Missing general audit event';end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('app.ctx_ready','0',true);
 if exists(select 1 from public.payroll_automation_settings) or exists(select 1 from public.payroll_automation_settings_history) then raise exception 'Unauthenticated settings leak';end if;
 begin
  perform public.payroll_save_automation_settings(v,expected_version+2,cfg);
  raise exception 'Unauthenticated save accepted';
 exception when raise_exception then if sqlerrm<>'Нет доступа' then raise;end if;end;
 raise notice 'PASS: settings persistence, immutable history, global audit, stale/cross-venue/anonymous writes rejected, no financial side effects';
end $test$;
rollback;
