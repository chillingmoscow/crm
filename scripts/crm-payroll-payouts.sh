#!/usr/bin/env bash
#
# Автовыдача зарплаты по утверждённому плану выплат (14:00 по Москве).
#
# Ставится на хост как /usr/local/bin/crm-payroll-payouts и запускается
# из /etc/cron.d/crm-payroll-payouts (14:00 по Москве независимо от пояса хоста):
#
#   CRON_TZ=Europe/Moscow
#   0 14 * * * root /usr/bin/flock -n /run/lock/crm-payroll-payouts.lock /usr/local/bin/crm-payroll-payouts >> /var/log/crm-payroll-payouts.log 2>&1
#
# «Сегодня» (рабочий день заведения) считается в поясе и с началом дня
# заведения. Автовыдача идёт только там, где она включена в «Графике выплат»;
# выключить на весь сервер — PAYROLL_PAYOUT_AUTO=off в окружении приложения.
#
# Как crm-module-workers: секрет CRON_SECRET остаётся в окружении
# приложения, на хосте его нет. Скрипт заходит в здоровый контейнер crm и
# зовёт маршрут изнутри по 127.0.0.1. Повторный запуск в тот же день
# безопасен: ключ выдачи — план + день (миграция 392); повтор находит выдачу
# и только досылает сообщение, если оно не ушло. Код 1 — что-то требует
# человека, а отчёт в чат отчётов не дошёл (смотрите этот лог).
set -euo pipefail
crm_container=$(docker ps --filter 'label=coolify.applicationUuid=ksg0sco00sw804c4c088wo48' --filter health=healthy --format '{{.ID}}' | head -n 1)
if [[ -z "$crm_container" ]]; then
  printf '%s CRM: no healthy container\n' "$(date -u +%FT%TZ)" >&2
  exit 1
fi
docker exec -i "$crm_container" node --input-type=module <<'JS'
if(!process.env.CRON_SECRET)throw Error('CRM cron secret is not configured');
try {
  const r=await fetch('http://127.0.0.1:3000/api/cron/payroll-payouts',{method:'POST',headers:{'x-cron-secret':process.env.CRON_SECRET},signal:AbortSignal.timeout(170000)});
  const body=await r.json().catch(()=>({}));
  console.log(JSON.stringify({at:new Date().toISOString(),worker:'payroll-payouts',status:r.status,...body}));
  if(!r.ok)process.exitCode=1;
} catch {console.error(JSON.stringify({at:new Date().toISOString(),worker:'payroll-payouts',error:'Worker request failed'}));process.exitCode=1;}
JS
