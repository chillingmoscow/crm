#!/usr/bin/env bash
#
# Ежедневная официальная выплата зарплаты (проведение и карточки «На разбор»).
#
# Ставится на хост как /usr/local/bin/crm-payroll-official и запускается
# из /etc/cron.d/crm-payroll-official:
#
#   10 0 * * * root /usr/bin/flock -n /run/lock/crm-payroll-official.lock /usr/local/bin/crm-payroll-official >> /var/log/crm-payroll-official.log 2>&1
#
# Хост живёт по Europe/Moscow, так что 00:10 — начало дня. «Сегодня» и день выплаты
# (настройка заведения) функция считает в поясе аккаунта (accounts.timezone).
#
# Как crm-module-workers: секрет CRON_SECRET остаётся в окружении
# приложения, на хосте его нет. Скрипт заходит в здоровый контейнер crm и
# зовёт маршрут изнутри по 127.0.0.1. Повторный запуск в тот же день
# безопасен: payroll_official_run (миграция 384) пишет только за месяцы,
# по которым записи ещё нет.
set -euo pipefail
crm_container=$(docker ps --filter 'label=coolify.applicationUuid=ksg0sco00sw804c4c088wo48' --filter health=healthy --format '{{.ID}}' | head -n 1)
if [[ -z "$crm_container" ]]; then
  printf '%s CRM: no healthy container\n' "$(date -u +%FT%TZ)" >&2
  exit 1
fi
docker exec -i "$crm_container" node --input-type=module <<'JS'
if(!process.env.CRON_SECRET)throw Error('CRM cron secret is not configured');
try {
  const r=await fetch('http://127.0.0.1:3000/api/cron/payroll-official',{method:'POST',headers:{'x-cron-secret':process.env.CRON_SECRET},signal:AbortSignal.timeout(55000)});
  const body=await r.json().catch(()=>({}));
  console.log(JSON.stringify({at:new Date().toISOString(),worker:'payroll-official',status:r.status,...body}));
  if(!r.ok)process.exitCode=1;
} catch {console.error(JSON.stringify({at:new Date().toISOString(),worker:'payroll-official',error:'Worker request failed'}));process.exitCode=1;}
JS
