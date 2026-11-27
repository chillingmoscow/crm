#!/usr/bin/env bash
#
# Утренняя проверка выплат зарплаты (10:00 по Москве): сверка выдачи по плану
# с изъятием из кассы Quick Resto, напоминание о невнесённой выплате
# переводом, автоперенос остатка месяца после второй выплаты.
#
# Ставится на хост как /usr/local/bin/crm-payroll-payout-check и запускается
# из /etc/cron.d/crm-payroll-payout-check (10:00 по Москве независимо от пояса хоста):
#
#   CRON_TZ=Europe/Moscow
#   0 10 * * * root /usr/bin/flock -n /run/lock/crm-payroll-payout-check.lock /usr/local/bin/crm-payroll-payout-check >> /var/log/crm-payroll-payout-check.log 2>&1
#
# Выключить на весь сервер — PAYROLL_PAYOUT_AUTO=off в окружении приложения
# (тот же выключатель, что у автовыдачи).
#
# Как crm-payroll-payouts: секрет CRON_SECRET остаётся в окружении
# приложения, на хосте его нет. Скрипт заходит в здоровый контейнер crm и
# зовёт маршрут изнутри по 127.0.0.1. Повторный запуск в тот же день
# безопасен (миграция 408). Код 1 — проверка упала или о проблеме никто не
# узнает: ни карточки, ни отчёта (смотрите этот лог).
set -euo pipefail
crm_container=$(docker ps --filter 'label=coolify.applicationUuid=ksg0sco00sw804c4c088wo48' --filter health=healthy --format '{{.ID}}' | head -n 1)
if [[ -z "$crm_container" ]]; then
  printf '%s CRM: no healthy container\n' "$(date -u +%FT%TZ)" >&2
  exit 1
fi
docker exec -i "$crm_container" node --input-type=module <<'JS'
if(!process.env.CRON_SECRET)throw Error('CRM cron secret is not configured');
try {
  const r=await fetch('http://127.0.0.1:3000/api/cron/payroll-payout-check',{method:'POST',headers:{'x-cron-secret':process.env.CRON_SECRET},signal:AbortSignal.timeout(170000)});
  const body=await r.json().catch(()=>({}));
  console.log(JSON.stringify({at:new Date().toISOString(),worker:'payroll-payout-check',status:r.status,...body}));
  if(!r.ok)process.exitCode=1;
} catch {console.error(JSON.stringify({at:new Date().toISOString(),worker:'payroll-payout-check',error:'Worker request failed'}));process.exitCode=1;}
JS
