#!/usr/bin/env bash
#
# Сторож бэкапа: ругается, если успешного бэкапа не было дольше положенного.
#
# Нужен потому, что письмо об ошибке приходит только когда скрипт запустился и
# упал. Если он не запустился вовсе — cron сняли, диск кончился, машина
# перезагружалась в нужный момент — писем не будет, и молчание будет выглядеть
# ровно как успех. Именно так на этой машине четыре месяца «работал» бэкап
# соседнего проекта.
#
# Ограничение, о котором честнее сказать вслух: сторож живёт на той же машине и
# в том же cron. Если умрёт машина целиком, промолчит и он. Полноценно эту дыру
# закрывает только внешний пинг (healthchecks.io и подобное) — если понадобится,
# сюда добавляется одна строка curl после успешной проверки.

set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# shellcheck disable=SC1091
set -a; source /root/.crm-backup-env; set +a

HEARTBEAT="${BACKUP_HEARTBEAT_FILE:-/var/lib/crm-backup/last-success}"
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-48}"

send_mail() {
  local subject="$1" body="$2"
  [ -n "${BACKUP_ALERT_EMAIL:-}" ] || return 0
  local encoded="=?UTF-8?B?$(printf '%s' "$subject" | base64 -w0)?="
  {
    printf 'From: %s <%s>\n' "${SMTP_SENDER_NAME:-Sheerly}" "$SMTP_ADMIN_EMAIL"
    printf 'To: %s\n' "$BACKUP_ALERT_EMAIL"
    printf 'Subject: %s\n' "$encoded"
    printf 'Content-Type: text/plain; charset=UTF-8\n\n'
    printf '%s\n' "$body"
  } | curl -sS --url "smtps://${SMTP_HOST}:${SMTP_PORT:-465}" --ssl-reqd \
        --mail-from "$SMTP_ADMIN_EMAIL" --mail-rcpt "$BACKUP_ALERT_EMAIL" \
        --user "${SMTP_USER}:${SMTP_PASS}" --upload-file - || true
}

if [ ! -f "$HEARTBEAT" ]; then
  send_mail "CRM: бэкапа не было ни разу" \
"Файла отметки об успешном бэкапе нет: ${HEARTBEAT}

Похоже, ночной бэкап не отработал ни разу с момента установки.

Сервер: $(hostname), $(date -u -Iseconds)"
  exit 1
fi

LAST=$(cat "$HEARTBEAT")
AGE_HOURS=$(( ( $(date -u +%s) - $(date -u -d "$LAST" +%s) ) / 3600 ))

if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  send_mail "CRM: бэкапа нет ${AGE_HOURS} часов" \
"Последний успешный бэкап: ${LAST} (${AGE_HOURS} часов назад).
Порог — ${MAX_AGE_HOURS} часов.

Писем об ошибке при этом могло не быть вовсе: скорее всего скрипт не
запускался, а не падал. Стоит посмотреть /var/log/crm-backup.log и cron.

Сервер: $(hostname), $(date -u -Iseconds)"
  exit 1
fi

echo "[$(date -u -Iseconds)] последний бэкап ${LAST}, ${AGE_HOURS} ч назад — в пределах ${MAX_AGE_HOURS} ч"
